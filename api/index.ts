import { createApp } from "../src/backend/app";

let appPromise: Promise<any> | null = null;

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = createApp();
  }
  try {
    const app = await appPromise;
    return app(req, res);
  } catch (error) {
    console.error("Failed to initialize app:", error);
    res.status(500).json({ error: "Internal Server Error during initialization" });
  }
}
