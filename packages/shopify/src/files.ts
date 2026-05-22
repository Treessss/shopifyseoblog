import { isRecord, ShopifyError, type ShopifyGraphQLClient } from "./client";
import type { ShopifyMutationUserError } from "./articles";

export interface ShopifyFileImageInput {
  originalSource: string;
  alt?: string;
  filename?: string;
}

export interface ShopifyUploadedImage {
  id: string;
  url: string;
  altText?: string | null;
  fileStatus?: string | null;
  width?: number | null;
  height?: number | null;
}

interface ShopifyFileCreatePayload {
  files?: ShopifyFileNode[];
  userErrors?: ShopifyMutationUserError[];
}

interface ShopifyFileNode {
  id?: string;
  fileStatus?: string | null;
  alt?: string | null;
  image?: {
    url?: string | null;
    altText?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
  preview?: {
    image?: {
      url?: string | null;
      altText?: string | null;
      width?: number | null;
      height?: number | null;
    } | null;
  } | null;
}

const FILE_IMAGE_FIELDS = /* GraphQL */ `
  id
  ... on MediaImage {
    fileStatus
    alt
    image {
      url
      altText
      width
      height
    }
    preview {
      image {
        url
        altText
        width
        height
      }
    }
  }
`;

const FILE_CREATE_MUTATION = /* GraphQL */ `
  mutation ShopifyFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        ${FILE_IMAGE_FIELDS}
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

const FILE_NODES_QUERY = /* GraphQL */ `
  query ShopifyFileNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ${FILE_IMAGE_FIELDS}
    }
  }
`;

export class ShopifyFileUserError extends ShopifyError {
  constructor(readonly userErrors: ShopifyMutationUserError[]) {
    super(`fileCreate returned user errors: ${userErrors.map((error) => error.message).join("; ")}`, userErrors);
    this.name = "ShopifyFileUserError";
  }
}

export async function uploadImageFile(
  client: ShopifyGraphQLClient,
  input: ShopifyFileImageInput,
  options: { pollAttempts?: number; pollDelayMs?: number } = {}
): Promise<ShopifyUploadedImage> {
  const payload = await client.request<{ fileCreate: ShopifyFileCreatePayload }>(FILE_CREATE_MUTATION, {
    files: [
      {
        originalSource: input.originalSource,
        contentType: "IMAGE",
        alt: input.alt,
        filename: input.filename
      }
    ]
  });

  const userErrors = payload.fileCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new ShopifyFileUserError(userErrors);
  }

  const created = payload.fileCreate?.files?.find(isRecord) as ShopifyFileNode | undefined;
  const initial = imageFromNode(created);
  if (initial?.url) return initial;

  const fileId = created?.id;
  if (!fileId) {
    throw new ShopifyError("fileCreate did not return a media image id.", payload.fileCreate);
  }

  const attempts = options.pollAttempts ?? 15;
  const delayMs = options.pollDelayMs ?? 2000;
  let lastStatus = created.fileStatus;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await delay(delayMs);
    const refreshed = await getImageFile(client, fileId);
    if (refreshed?.url) return refreshed;
    lastStatus = refreshed?.fileStatus ?? lastStatus;
  }

  throw new ShopifyError("Shopify uploaded the image but did not return a hosted image URL yet.", {
    fileId,
    fileStatus: lastStatus
  });
}

async function getImageFile(client: ShopifyGraphQLClient, id: string): Promise<ShopifyUploadedImage | null> {
  const payload = await client.request<{ nodes: Array<ShopifyFileNode | null> }>(FILE_NODES_QUERY, {
    ids: [id]
  });
  return imageFromNode(payload.nodes?.find(isRecord) as ShopifyFileNode | undefined);
}

function imageFromNode(node: ShopifyFileNode | undefined): ShopifyUploadedImage | null {
  if (!node?.id) return null;
  const image = node.image ?? node.preview?.image ?? null;
  return {
    id: node.id,
    url: image?.url ?? "",
    altText: image?.altText ?? node.alt ?? null,
    fileStatus: node.fileStatus ?? null,
    width: image?.width ?? null,
    height: image?.height ?? null
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
