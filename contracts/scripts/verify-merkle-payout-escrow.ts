/**
 * Submits MerklePayoutEscrow source + constructor args to the network explorer.
 *
 * Prereqs in `contracts/.env`:
 *   ETHERSCAN_API_KEY=...           (from https://etherscan.io/apis — unified v2; supports BSC testnet)
 *   optional: BSCSCAN_API_KEY=...    (alias read by hardhat.config if ETHERSCAN_API_KEY unset)
 *   VERIFY_CONTRACT_ADDRESS=0x...
 *   ESCROW_OWNER_ADDRESS=0x...   (same as deploy constructor `owner`)
 */
import { getAddress, isAddress } from "ethers";
import hre from "hardhat";

async function main(): Promise<void> {
  const addressRaw = process.env.VERIFY_CONTRACT_ADDRESS?.trim();
  if (!addressRaw || !isAddress(addressRaw)) {
    throw new Error(
      "VERIFY_CONTRACT_ADDRESS must be set to the deployed contract address (0x-prefixed, 42 chars).",
    );
  }
  const contractAddress = getAddress(addressRaw);

  const ownerCandidate = process.env.ESCROW_OWNER_ADDRESS?.trim();
  if (!ownerCandidate || !isAddress(ownerCandidate)) {
    throw new Error(
      "ESCROW_OWNER_ADDRESS must match the owner argument used when this contract was deployed.",
    );
  }
  const ownerAddress = getAddress(ownerCandidate);

  await hre.run("verify:verify", {
    address: contractAddress,
    contract: "contracts/MerklePayoutEscrow.sol:MerklePayoutEscrow",
    constructorArguments: [ownerAddress],
  });

  console.info("Explorer verification submitted for MerklePayoutEscrow at", contractAddress);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
