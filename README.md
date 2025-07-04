# 🔄 Circle Paymaster: ERC20 Gas Payment with Account Abstraction

This project demonstrates how to enable **ERC20 token-based gas payments** using **Account Abstraction (ERC-4337)**.  
It integrates a Circle-compatible **Paymaster**, a Bundler, and a Smart Account, leveraging the **EIP-2612 Permit standard** to securely authorize gas payments.

---

## 🌟 Key Features

- ✅ **ERC-4337 Account Abstraction**: Smart accounts that abstract away native token gas fees.
- ✅ **ERC20 Gas Payments**: Pay for gas using ERC20 tokens like USDC.
- ✅ **Circle Paymaster Integration**: Handles gas payment through a Circle-compatible Paymaster.
- ✅ **EIP-2612 Permit Signing**: Authorize token transfers without prior on-chain approval.
- ✅ **Bundler Integration**: Sends user operations to a Bundler for execution.

---

## 🛠️ Architecture Overview


1. **User** sends a transaction via a Smart Account.
2. The Smart Account signs a Permit allowing the Paymaster to use ERC20 tokens for gas.
3. The **Bundler** aggregates and sends the user operation.
4. The **Paymaster** validates the permit and settles the gas fees with ERC20 tokens.
5. The transaction executes on-chain without the user holding the native token.

---

## ⚙️ Tech Stack

- Node.js (ES Modules)
- [Viem](https://viem.sh) – Ethereum client library
- Circle Modular Wallets
- Pimlico Bundler and Paymaster RPCs
- ERC20 Token (USDC)

---


---

## 🔑 Environment Variables

Create a `.env` file in the project root:

```bash
PAYMASTER_V07_ADDRESS=0xYourPaymasterAddress
OWNER_PRIVATE_KEY=0xYourPrivateKey
USDC_ADDRESS=0xYourUSDCContract

