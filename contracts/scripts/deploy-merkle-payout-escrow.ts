/**
 * Deploy MerklePayoutEscrow (BSC testnet or any configured network).
 *
 *   DEPLOYER_PRIVATE_KEY=0x...
 *   ESCROW_OWNER_ADDRESS=0x...   (optional multisig)
 */
import { getAddress, isAddress } from "ethers";
import { ethers } from "hardhat";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const ownerCandidate = process.env.ESCROW_OWNER_ADDRESS?.trim();

  let ownerAddress: string;
  if (ownerCandidate && ownerCandidate.length >= 42 && isAddress(ownerCandidate)) {
    ownerAddress = getAddress(ownerCandidate);
    console.info("Owner (Ownable):", ownerAddress);
  } else {
    ownerAddress = deployer.address;
    console.warn("ESCROW_OWNER_ADDRESS unset; deployer is owner:", deployer.address);
  }

  const factory = await ethers.getContractFactory("MerklePayoutEscrow");
  const escrow = await factory.deploy(ownerAddress);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.info("MerklePayoutEscrow deployed at:", address);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
