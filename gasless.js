const { ethers } = require('ethers');
const { encodePacked, getContract, erc20Abi, maxUint256, parseErc6492Signature } = require('viem');
const { createPublicClient, http } = require('viem');
const { createBundlerClient } = require('viem/account-abstraction');

// Paymaster configuration based on network
const PAYMASTER_CONFIG = {
    // Arbitrum Sepolia (testnet)
    421614: {
        address: process.env.PAYMASTER_V07_ADDRESS, // v0.7
        bundlerUrl: 'https://public.pimlico.io/v2/421614/rpc'
    },
    // Arbitrum One (mainnet)
    42161: {
        address: process.env.PAYMASTER_V07_ADDRESS,
        bundlerUrl: 'https://public.pimlico.io/v2/42161/rpc'
    },
    // Base Mainnet (mainnet)
    8453: {
        address: process.env.PAYMASTER_V07_ADDRESS,
        bundlerUrl: 'https://public.pimlico.io/v2/8453/rpc'
    },
    // Base Sepolia (testnet)
    84532: {
        address: process.env.PAYMASTER_V07_ADDRESS,
        bundlerUrl: 'https://public.pimlico.io/v2/84532/rpc'
    }
};

// EIP-2612 ABI extension for permit functionality
const eip2612Abi = [
    ...erc20Abi,
    {
        inputs: [{ internalType: "address", name: "owner", type: "address" }],
        stateMutability: "view",
        type: "function",
        name: "nonces",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    },
    {
        inputs: [],
        name: "version",
        outputs: [{ internalType: "string", name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
];

async function eip2612Permit({ token, chain, ownerAddress, spenderAddress, value }) {
    return {
        types: {
            Permit: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
        },
        primaryType: "Permit",
        domain: {
            name: await token.read.name(),
            version: await token.read.version(),
            chainId: chain.id,
            verifyingContract: token.address,
        },
        message: {
            owner: ownerAddress,
            spender: spenderAddress,
            value,
            nonce: await token.read.nonces([ownerAddress]),
            // Paymaster requires MAX_UINT256 due to 4337 opcode restrictions
            deadline: maxUint256,
        },
    };
}

async function signPermit({ tokenAddress, client, account, spenderAddress, permitAmount }) {
    const token = getContract({
        client,
        address: tokenAddress,
        abi: eip2612Abi,
    });

    const permitData = await eip2612Permit({
        token,
        chain: client.chain,
        ownerAddress: account.address,
        spenderAddress,
        value: permitAmount,
    });

    const wrappedPermitSignature = await account.signTypedData(permitData);
    
    const isValid = await client.verifyTypedData({
        ...permitData,
        address: account.address,
        signature: wrappedPermitSignature,
    });

    if (!isValid) {
        throw new Error(`Invalid permit signature for ${account.address}: ${wrappedPermitSignature}`);
    }

    const { signature } = parseErc6492Signature(wrappedPermitSignature);
    return signature;
}

function createPaymasterConfig({ usdcAddress, paymasterAddress, account, client }) {
    return {
        async getPaymasterData(parameters) {
            // Estimate permit amount based on transaction value + buffer for gas
            const permitAmount = ethers.parseUnits("100", 6); // 100 USDC buffer
            
            const permitSignature = await signPermit({
                tokenAddress: usdcAddress,
                account,
                client,
                spenderAddress: paymasterAddress,
                permitAmount: permitAmount,
            });

            const paymasterData = encodePacked(
                ["uint8", "address", "uint256", "bytes"],
                [0, usdcAddress, permitAmount, permitSignature]
            );

            return {
                paymaster: paymasterAddress,
                paymasterData,
                paymasterVerificationGasLimit: 200000n,
                paymasterPostOpGasLimit: 15000n,
                isFinal: true,
            };
        },
    };
}

async function executeGaslessTransaction({
    userWallet,
    networkId,
    usdcAddress,
    providerWallet,
    usdtAmount,
    decimals,
    currency
}) {
    const paymasterConfig = PAYMASTER_CONFIG[networkId];
    if (!paymasterConfig) {
        throw new Error(`Paymaster not supported on network ${networkId}`);
    }

    const client = createPublicClient({
        chain: { id: networkId },
        transport: http(process.env.ETH_PROVIDER_URL)
    });

    const account = {
        address: userWallet.address,
        signTypedData: async (typedData) => {
            return await userWallet.signTypedData(
                typedData.domain,
                typedData.types,
                typedData.message
            );
        }
    };

    // Create paymaster configuration
    const paymaster = createPaymasterConfig({
        usdcAddress,
        paymasterAddress: paymasterConfig.address,
        account,
        client
    });

    // Create bundler client
    const bundlerClient = createBundlerClient({
        account,
        client,
        paymaster,
        userOperation: {
            estimateFeesPerGas: async ({ account, bundlerClient, userOperation }) => {
                const { standard: fees } = await bundlerClient.request({
                    method: "pimlico_getUserOperationGasPrice",
                });
                return {
                    maxFeePerGas: BigInt(fees.maxFeePerGas),
                    maxPriorityFeePerGas: BigInt(fees.maxPriorityFeePerGas)
                };
            },
        },
        transport: http(paymasterConfig.bundlerUrl),
    });

    // Execute gasless USDC transfer
    const hash = await bundlerClient.sendUserOperation({
        account,
        calls: [
            {
                to: usdcAddress,
                abi: erc20Abi,
                functionName: "transfer",
                args: [providerWallet, usdtAmount],
            },
        ],
    });

    // Wait for transaction confirmation
    const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
    
    return {
        userOpHash: hash,
        transactionHash: receipt.receipt.transactionHash,
        gasUsed: receipt.receipt.gasUsed,
        success: receipt.success
    };
}

function isPaymasterSupported(networkId) {
    return networkId in PAYMASTER_CONFIG;
}

async function estimateGasCostInUSDC({ networkId, gasLimit = 300000 }) {
    const gasPrice = ethers.parseUnits("0.1", "gwei"); // Example gas price
    const gasCostInEth = gasPrice * BigInt(gasLimit);
    
    const ethToUsdcRate = 2000; // Example: 1 ETH = 2000 USDC
    const gasCostInUSDC = (gasCostInEth * BigInt(ethToUsdcRate)) / ethers.parseUnits("1", 18);
    
    return ethers.formatUnits(gasCostInUSDC, 6);
}

module.exports = {
    createPaymasterConfig,
    executeGaslessTransaction,
    isPaymasterSupported,
    estimateGasCostInUSDC,
    signPermit,
    PAYMASTER_CONFIG
};