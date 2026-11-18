// Vercel serverless entry: every /api/* request is rewritten here (vercel.json).
// The Express app itself lives in backend/ and is shared with the Render/local server.
export { default } from "../backend/vercel.js";
