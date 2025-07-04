import "dotenv/config";
import { createPublicClient, http, getContract } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { toCircleSmartAccount } from "@circle-fin/modular-wallets-core";
import { erc20Abi } from "viem";
import { encodePacked } from "viem";
import { signPermit } from "./permit.js";
import { createBundlerClient } from "viem/account-abstraction";
import { hexToBigInt } from "viem";



const recipientAddress = process.env.RECIPIENT_ADDRESS;

const paymasterAddress = process.env.PAYMASTER_V07_ADDRESS;

const chain = baseSepolia;
const usdcAddress = process.env.USDC_ADDRESS;
const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;

const client = createPublicClient({ chain, transport: http() });
const owner = privateKeyToAccount(ownerPrivateKey);
const account = await toCircleSmartAccount({ client, owner });



const usdc = getContract({ client, address: usdcAddress, abi: erc20Abi });
const usdcBalance = await usdc.read.balanceOf([account.address]);

console.log(account.address)

if (usdcBalance < 1000000) {
  console.log(
    `Fund ${account.address} with USDC on ${client.chain.name} using https://faucet.circle.com, then run this again.`,
  );
  process.exit();
}


const paymaster = {
  async getPaymasterData(parameters) {
    const permitAmount = 10000000n;
    const permitSignature = await signPermit({
      tokenAddress: usdcAddress,
      account,
      client,
      spenderAddress: paymasterAddress,
      permitAmount: permitAmount,
    });

    const paymasterData = encodePacked(
      ["uint8", "address", "uint256", "bytes"],
      [0, usdcAddress, permitAmount, permitSignature],
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

const bundlerClient = createBundlerClient({
  account,
  client,
  paymaster,
  userOperation: {
    estimateFeesPerGas: async ({ account, bundlerClient, userOperation }) => {
      const { standard: fees } = await bundlerClient.request({
        method: "pimlico_getUserOperationGasPrice",
      });
      const maxFeePerGas = hexToBigInt(fees.maxFeePerGas);
      const maxPriorityFeePerGas = hexToBigInt(fees.maxPriorityFeePerGas);
      return { maxFeePerGas, maxPriorityFeePerGas };
    },
  },
  transport: http(`https://public.pimlico.io/v2/${client.chain.id}/rpc`),
});


const hash = await bundlerClient.sendUserOperation({
  account,
  calls: [
    {
      to: usdc.address,
      abi: usdc.abi,
      functionName: "transfer",
      args: [recipientAddress, 10000n],
    },
  ],
});
console.log("UserOperation hash", hash);

const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
console.log("Transaction hash", receipt.receipt.transactionHash);

// We need to manually exit the process, since viem leaves some promises on the
// event loop for features we're not using.
process.exit();