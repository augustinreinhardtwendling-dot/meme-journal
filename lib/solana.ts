import { PublicKey } from "@solana/web3.js";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const PUMP_MIGRATION_AUTHORITY = "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const METAPLEX_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Supply standard d'un coin pump.fun (1 milliard, 6 décimales). */
export const PUMP_SUPPLY = 1_000_000_000;

/** Une adresse hors de la courbe ed25519 est un PDA : un compte de programme, pas un wallet. */
export function isProgramOwned(address: string): boolean {
  try {
    return !PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export function metaplexMetadataPda(mint: string): string {
  const program = new PublicKey(METAPLEX_PROGRAM);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), program.toBuffer(), new PublicKey(mint).toBuffer()],
    program,
  );
  return pda.toBase58();
}

/** Compte de token associé (ATA) d'un wallet pour un mint, selon le programme de token. */
export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM),
  );
  return ata.toBase58();
}

/** Liens publics d'un coin. */
export function coinLinks(mint: string) {
  return {
    pumpfun: `https://pump.fun/coin/${mint}`,
    dexscreener: `https://dexscreener.com/solana/${mint}`,
    solscan: `https://solscan.io/token/${mint}`,
  };
}
