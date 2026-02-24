import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Email sending endpoint
  app.post("/api/send-emails", async (req, res) => {
    const { recipients, template, smtpConfig } = req.body;

    if (!recipients || !template) {
      return res.status(400).json({ error: "Faltan destinatarios o plantilla" });
    }

    // Use provided SMTP config or environment variables
    const transporter = nodemailer.createTransport({
      host: smtpConfig?.host || process.env.SMTP_HOST,
      port: parseInt(smtpConfig?.port || process.env.SMTP_PORT || "587"),
      secure: smtpConfig?.port === "465",
      auth: {
        user: smtpConfig?.user || process.env.SMTP_USER,
        pass: smtpConfig?.pass || process.env.SMTP_PASS,
      },
    });

    const results = [];

    for (const recipient of recipients) {
      try {
        let personalizedBody = template.body;
        let personalizedSubject = template.subject;

        // Simple variable replacement
        Object.keys(recipient).forEach((key) => {
          const value = recipient[key];
          const regex = new RegExp(`{{${key}}}`, "g");
          personalizedBody = personalizedBody.replace(regex, value);
          personalizedSubject = personalizedSubject.replace(regex, value);
        });

        await transporter.sendMail({
          from: smtpConfig?.from || process.env.SMTP_FROM || smtpConfig?.user || process.env.SMTP_USER,
          to: recipient.email || recipient.Email || recipient.Correo || recipient.correo,
          subject: personalizedSubject,
          html: personalizedBody,
        });

        results.push({ email: recipient.email || recipient.Correo, status: "sent" });
      } catch (error: any) {
        console.error(`Error enviando a ${recipient.email}:`, error);
        results.push({ email: recipient.email || recipient.Correo, status: "failed", error: error.message });
      }
    }

    res.json({ results });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

startServer();
