declare module "node:crypto" {
  export function createHmac(
    algorithm: string,
    key: string
  ): {
    update(data: string): {
      digest(encoding: "hex"): string;
    };
  };

  export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean;
}

declare const Buffer: {
  from(input: string, encoding?: BufferEncoding): Uint8Array & { length: number };
};

type BufferEncoding = "utf8" | "hex" | "base64" | "base64url" | "latin1" | "ascii" | "utf16le" | "ucs2";
