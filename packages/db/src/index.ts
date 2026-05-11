import { loadWorkspaceEnv } from "./env";
import { PrismaClient } from "@prisma/client";

loadWorkspaceEnv();

export * from "@prisma/client";
export {
  decryptSecret,
  encryptSecret,
  hashSecret,
  isEncryptedSecret,
  maybeDecryptSecret,
  redactSecret,
  EncryptedSecretError,
  EncryptionKeyError
} from "./encryption";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type DbClient = PrismaClient;
