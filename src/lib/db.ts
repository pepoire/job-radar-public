/**
 * Prisma クライアントのシングルトン。
 * Next.js の開発時はホットリロードで何度も評価されるため、
 * グローバルに載せて接続が増え続けるのを防ぐ。
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
