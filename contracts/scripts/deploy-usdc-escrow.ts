/**
 * Deploys UsdcTransparentEscrow on the selected Hardhat network.
 *
 * Recommended for BSC Testnet env:
 *   DEPLOYER_PRIVATE_KEY=0x... (one-time funded deploy account)
 *   ESCROW_OWNER_ADDRESS=0x... (multisig or cold wallet operator address)
 * Optional:
 *   BSC_TESTNET_RPC_URL=https://...
 */
import { getAddress, isAddress } from "ethers";
import { ethers } from "hardhat";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const escrowOwnerCandidate = process.env.ESCROW_OWNER_ADDRESS?.trim();

  let initialOwnerAddress: string;
  if (
    escrowOwnerCandidate &&
    escrowOwnerCandidate.length >= 42 &&
    isAddress(escrowOwnerCandidate)
  ) {
    initialOwnerAddress = getAddress(escrowOwnerCandidate);
    console.info("Using ESCROW_OWNER_ADDRESS as Ownable initialOwner:", initialOwnerAddress);
  } else {
    initialOwnerAddress = deployer.address;
    console.warn(
      [
        "ESCROW_OWNER_ADDRESS not set or invalid; deployer becomes owner.",
        "For production/transparency, deploy MULTISIG or cold wallet:",
        "- set ESCROW_OWNER_ADDRESS to multisig BEFORE deploy.",
        "",
        `Deployer: ${deployer.address}`,
      ].join("\n"),
    );
  }

  const factory = await ethers.getContractFactory("UsdcTransparentEscrow");
  const escrowContract = await factory.deploy(initialOwnerAddress);
  await escrowContract.waitForDeployment();

  const deployedAddress = await escrowContract.getAddress();
  console.info("Deployed UsdcTransparentEscrow at:", deployedAddress);
  console.info("Owner:", await escrowContract.owner());

  console.info(
    "\nConfigure your bot POLL_USDC_ESCROW_ADDRESS / Network record to:",
    deployedAddress,
  );
  console.info(
    "Payout path: call withdraw(token,recipient,amount,memo) as owner instead of EOAs raw transfer.",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
