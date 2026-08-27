/**
 * Shopify Files upload — two-step flow:
 *   1. stagedUploadsCreate → returns a target URL + form params
 *   2. POST the file bytes to that URL (multipart/form-data)
 *   3. fileCreate → registers the staged upload as a Shopify File
 *   4. Poll fileQuery until status === READY → return the CDN url
 *
 * Used by app/routes/app.api.upload.jsx for the email editor's image block, the
 * brand-kit logo, and the content library.
 *
 * Handles images and generic files (PDFs). The two differ throughout: they take
 * a different contentType on fileCreate and resolve to a different GraphQL type
 * on read, so a PDF pushed through the image-only path would poll for an
 * `image { url }` that never arrives and time out after 20 seconds.
 */

const STAGED_UPLOADS_CREATE = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = `#graphql
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        ... on MediaImage {
          image { url width height }
        }
        ... on GenericFile {
          url
        }
      }
      userErrors { field message }
    }
  }
`;

const FILE_QUERY = `#graphql
  query fileQuery($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        image { url width height altText }
      }
      ... on GenericFile {
        id
        fileStatus
        url
      }
    }
  }
`;

const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS = 20000;

function userErrorMessage(errors) {
  return (errors || []).map((e) => e.message).join("; ");
}

/**
 * @param {{ admin: { graphql: Function } }} ctx — admin client from authenticate.admin / unauthenticated.admin
 * @param {{ filename: string, mimeType: string, fileSize: number, bytes: Uint8Array | Buffer, alt?: string }} file
 * @returns {Promise<{ url: string, width: number, height: number, fileId: string }>}
 */
export async function uploadImageToShopifyFiles({ admin }, file) {
  if (!file?.bytes?.length) throw new Error("uploadImageToShopifyFiles: empty file");

  // Shopify types uploads as IMAGE or FILE, and each resolves to a different
  // GraphQL node type when we poll for the CDN url below.
  const isImage = String(file.mimeType || "").startsWith("image/");
  const contentType = isImage ? "IMAGE" : "FILE";

  // 1. Stage the upload
  const stagedResp = await admin.graphql(STAGED_UPLOADS_CREATE, {
    variables: {
      input: [
        {
          filename: file.filename,
          mimeType: file.mimeType,
          httpMethod: "POST",
          resource: "FILE",
          fileSize: String(file.fileSize),
        },
      ],
    },
  });
  const stagedJson = await stagedResp.json();
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors;
  if (stagedErrors?.length) throw new Error(`stagedUploadsCreate: ${userErrorMessage(stagedErrors)}`);

  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) {
    throw new Error("stagedUploadsCreate: no target returned");
  }

  // 2. Upload bytes to the staged URL
  const form = new FormData();
  for (const p of target.parameters || []) form.append(p.name, p.value);
  form.append("file", new Blob([file.bytes], { type: file.mimeType }), file.filename);

  const uploadResp = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => "");
    throw new Error(`staged upload POST failed: ${uploadResp.status} ${text.slice(0, 200)}`);
  }

  // 3. Register the staged upload as a Shopify File
  const createResp = await admin.graphql(FILE_CREATE, {
    variables: {
      files: [
        {
          alt: file.alt || "",
          contentType,
          originalSource: target.resourceUrl,
        },
      ],
    },
  });
  const createJson = await createResp.json();
  const createErrors = createJson.data?.fileCreate?.userErrors;
  if (createErrors?.length) throw new Error(`fileCreate: ${userErrorMessage(createErrors)}`);

  const created = createJson.data?.fileCreate?.files?.[0];
  if (!created?.id) throw new Error("fileCreate: no file returned");

  // 4. Poll until READY (Shopify processes the upload asynchronously)
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const queryResp = await admin.graphql(FILE_QUERY, { variables: { id: created.id } });
    const queryJson = await queryResp.json();
    const node = queryJson.data?.node;
    // MediaImage exposes the CDN url under image{}; GenericFile exposes it
    // directly. Either satisfies "ready".
    const readyUrl = node?.image?.url || node?.url;
    if (node?.fileStatus === "READY" && readyUrl) {
      return {
        url: readyUrl,
        width: node.image?.width || 0,
        height: node.image?.height || 0,
        fileId: node.id,
      };
    }
    if (node?.fileStatus === "FAILED") {
      throw new Error("fileCreate: Shopify reported FAILED status");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("fileCreate: timed out waiting for READY status");
}
