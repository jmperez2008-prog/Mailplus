import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-this";

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// In-memory fallback
let localUsers: any[] = [];

// Helper to get users (from DB or local)
const getUsers = async () => {
  if (supabase) {
    const { data, error } = await supabase.from('app_users').select('*');
    if (error) {
      console.error("Supabase error fetching users:", error);
      return [];
    }
    return data || [];
  }
  return localUsers;
};

// Helper to find user
const findUserByUsername = async (username: string) => {
  if (supabase) {
    const { data } = await supabase.from('app_users').select('*').eq('username', username).single();
    return data;
  }
  return localUsers.find(u => u.username === username);
};

const findUserById = async (id: string) => {
  if (supabase) {
    const { data } = await supabase.from('app_users').select('*').eq('id', id).single();
    return data;
  }
  return localUsers.find(u => u.id === id);
};

// Initialize default admin
const initializeDefaultAdmin = async () => {
  const hashedPassword = await bcrypt.hash("Alacena66@2026", 10);
  const adminUser = {
    username: "Juanma",
    password: hashedPassword,
    role: "admin",
    smtp_config: { host: "", port: "587", user: "", pass: "", from: "" },
    signature: "<p>Saludos,<br><strong>Juanma</strong><br>Administrador</p>"
  };

  if (supabase) {
    // Check if admin exists
    const { data } = await supabase.from('app_users').select('*').eq('username', 'Juanma').single();
    if (!data) {
      await supabase.from('app_users').insert([adminUser]);
      console.log("Default admin initialized in Supabase");
    }
  } else {
    // Check if admin exists in local
    if (!localUsers.find(u => u.username === "Juanma")) {
        localUsers.push({ ...adminUser, id: "1", smtpConfig: adminUser.smtp_config });
        console.log("Default admin initialized in memory");
    }
  }
};

export async function createApp() {
  await initializeDefaultAdmin();

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Authentication Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // --- Auth Routes ---

  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await findUserByUsername(username);

    if (!user) {
      return res.status(400).json({ error: "Usuario no encontrado" });
    }

    if (await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
      // Return user without password
      const { password, ...userWithoutPassword } = user;
      // Normalize keys for frontend (snake_case DB -> camelCase frontend if needed)
      const mappedUser = {
        ...userWithoutPassword,
        smtpConfig: user.smtp_config || user.smtpConfig
      };
      res.json({ token, user: mappedUser });
    } else {
      res.status(403).json({ error: "Contraseña incorrecta" });
    }
  });

  // --- User Management Routes ---

  // Get all users (Admin only)
  app.get("/api/users", authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const users = await getUsers();
    const safeUsers = users.map(({ password, ...u }) => ({
      ...u,
      smtpConfig: u.smtp_config || u.smtpConfig
    }));
    res.json(safeUsers);
  });

  // Create user (Admin only)
  app.post("/api/users", authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const { username, password, role } = req.body;

    if (await findUserByUsername(username)) {
      return res.status(400).json({ error: "El usuario ya existe" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      username,
      password: hashedPassword,
      role: role || 'user',
      smtp_config: { host: "", port: "587", user: "", pass: "", from: "" },
      signature: ""
    };

    if (supabase) {
      const { data, error } = await supabase.from('app_users').insert([newUser]).select().single();
      if (error) return res.status(500).json({ error: error.message });
      const { password: _, ...safeUser } = data;
      res.json({ ...safeUser, smtpConfig: safeUser.smtp_config });
    } else {
      const localUser = { ...newUser, id: Date.now().toString(), smtpConfig: newUser.smtp_config };
      localUsers.push(localUser);
      const { password: _, ...safeUser } = localUser;
      res.json(safeUser);
    }
  });

  // Update user (Self or Admin)
  app.put("/api/users/:id", authenticateToken, async (req: any, res) => {
    const userId = req.params.id;
    // Allow if admin or if updating self
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.sendStatus(403);
    }

    const user = await findUserById(userId);
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    const { smtpConfig, signature, password } = req.body;
    
    const updates: any = {};
    if (smtpConfig) updates.smtp_config = smtpConfig;
    if (signature !== undefined) updates.signature = signature;
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (supabase) {
      const { data, error } = await supabase.from('app_users').update(updates).eq('id', userId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      const { password: _, ...safeUser } = data;
      res.json({ ...safeUser, smtpConfig: safeUser.smtp_config });
    } else {
      // Local update
      const userIndex = localUsers.findIndex(u => u.id === userId);
      if (smtpConfig) localUsers[userIndex].smtpConfig = smtpConfig;
      if (signature !== undefined) localUsers[userIndex].signature = signature;
      if (password) localUsers[userIndex].password = updates.password;
      
      const { password: _, ...safeUser } = localUsers[userIndex];
      res.json(safeUser);
    }
  });

  // Delete user (Admin only)
  app.delete("/api/users/:id", authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const userId = req.params.id;
    
    // Prevent deleting self
    if (userId === req.user.id) {
      return res.status(400).json({ error: "No puedes eliminar tu propio usuario" });
    }

    if (supabase) {
      const { error } = await supabase.from('app_users').delete().eq('id', userId);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      const userIndex = localUsers.findIndex(u => u.id === userId);
      if (userIndex === -1) return res.status(404).json({ error: "Usuario no encontrado" });
      localUsers.splice(userIndex, 1);
    }

    res.json({ message: "Usuario eliminado" });
  });

  // --- Email Routes ---

  // Email sending endpoint
  app.post("/api/send-emails", authenticateToken, async (req: any, res) => {
    // Get user from DB to ensure we have latest SMTP config
    const user = await findUserById(req.user.id);
    if (!user) return res.sendStatus(403);

    const { recipients, template } = req.body;
    // Handle both DB casing (snake) and local casing (camel)
    const smtpConfig = user.smtp_config || user.smtpConfig;
    const signature = user.signature;

    if (!recipients || !template) {
      return res.status(400).json({ error: "Faltan destinatarios o plantilla" });
    }

    if (!smtpConfig || !smtpConfig.host || !smtpConfig.user) {
      return res.status(400).json({ error: "Configuración SMTP incompleta. Por favor configúrala en tu perfil." });
    }

    // Use provided SMTP config or environment variables
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: parseInt(smtpConfig.port || "587"),
      secure: smtpConfig.port === "465",
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
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

        // Append signature if exists
        if (signature) {
          personalizedBody += `<br><br><div class="signature">${signature}</div>`;
        }

        await transporter.sendMail({
          from: smtpConfig.from || smtpConfig.user,
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

  return app;
}
