import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";

dotenv.config();

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";
// Etherscan API v2: must be a single string key (not per-network map) or Hardhat falls back to deprecated explorer v1 URLs.
// Use a key from https://etherscan.io/apis — it supports BNB Smart Chain testnet (chainId 97) via the unified v2 API.
const explorerApiKey =
  process.env.ETHERSCAN_API_KEY?.trim() || process.env.BSCSCAN_API_KEY?.trim() || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    bscTestnet: {
      url:
        process.env.BSC_TESTNET_RPC_URL ??
        "https://data-seed-prebsc-1-s1.binance.org:8545/",
      ...(deployerPrivateKey.startsWith("0x") && deployerPrivateKey.length === 66
        ? { accounts: [deployerPrivateKey] }
        : {}),
      chainId: 97,
    },
  },
  etherscan: {
    apiKey: explorerApiKey,
  },
};

export default config;
