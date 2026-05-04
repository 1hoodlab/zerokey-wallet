import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";

dotenv.config();

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";

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
};

export default config;
