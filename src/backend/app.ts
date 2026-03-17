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
  try {
    const hashedPassword = await bcrypt.hash("Alacena66@2026", 10);
    const adminUser = {
      username: "Juanma",
      password: hashedPassword,
      role: "admin",
      smtp_config: { host: "", port: "587", user: "", pass: "", from: "", signature_image: "", logo: "" },
      signature: "<p>Saludos,<br><strong>Juanma</strong><br>Administrador</p>"
    };

    if (supabase) {
      // Check if admin exists
      const { data, error } = await supabase.from('app_users').select('*').eq('username', 'Juanma').single();
      
      if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found"
        console.error("Error checking admin user in Supabase:", error);
      }

      if (!data) {
        const { error: insertError } = await supabase.from('app_users').insert([adminUser]);
        if (insertError) {
          console.error("Error creating default admin in Supabase:", insertError);
        } else {
          console.log("Default admin initialized in Supabase");
        }
      }
    } else {
      // Check if admin exists in local
      if (!localUsers.find(u => u.username === "Juanma")) {
          localUsers.push({ ...adminUser, id: "1", smtpConfig: adminUser.smtp_config });
          console.log("Default admin initialized in memory");
      }
    }
  } catch (error) {
    console.error("Critical error initializing default admin:", error);
  }
};

export async function createApp() {
  try {
    await initializeDefaultAdmin();
  } catch (error) {
    console.error("Failed to initialize admin:", error);
  }

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      supabaseConnected: !!supabase,
      hasUrl: !!process.env.SUPABASE_URL,
      hasKey: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
    });
  });

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
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Usuario y contraseña requeridos" });
      }

      const user = await findUserByUsername(username);

      if (!user) {
        return res.status(400).json({ error: "Usuario no encontrado" });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (isPasswordValid) {
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
        // Return user without password
        const { password, ...userWithoutPassword } = user;
        // Normalize keys for frontend (snake_case DB -> camelCase frontend if needed)
        const mappedUser = {
          ...userWithoutPassword,
          smtpConfig: user.smtp_config || user.smtpConfig,
          signatureImage: user.signature_image || (user.smtp_config && user.smtp_config.signature_image) || user.signatureImage || "",
          logo: user.logo || (user.smtp_config && user.smtp_config.logo) || ""
        };
        res.json({ token, user: mappedUser });
      } else {
        res.status(403).json({ error: "Contraseña incorrecta" });
      }
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  // --- User Management Routes ---

  // Get all users (Admin only)
  app.get("/api/users", authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    const users = await getUsers();
    const safeUsers = users.map(({ password, ...u }) => ({
      ...u,
      smtpConfig: u.smtp_config || u.smtpConfig,
      signatureImage: u.signature_image || (u.smtp_config && u.smtp_config.signature_image) || u.signatureImage || "",
      logo: u.logo || (u.smtp_config && u.smtp_config.logo) || ""
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
      smtp_config: { host: "", port: "587", user: "", pass: "", from: "", signature_image: "", logo: "" },
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

    const { smtpConfig, signature, signatureImage, password, logo } = req.body;
    
    const updates: any = {};
    const currentSmtpConfig = user.smtp_config || {};
    const newSmtpConfig = { ...currentSmtpConfig, ...(smtpConfig || {}) };

    if (signature !== undefined) updates.signature = signature;
    if (signatureImage !== undefined) newSmtpConfig.signature_image = signatureImage;
    if (logo !== undefined) newSmtpConfig.logo = logo;
    
    updates.smtp_config = newSmtpConfig;

    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (supabase) {
      const { data, error } = await supabase.from('app_users').update(updates).eq('id', userId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      const { password: _, ...safeUser } = data;
      res.json({ 
        ...safeUser, 
        smtpConfig: safeUser.smtp_config,
        signatureImage: safeUser.signature_image || (safeUser.smtp_config && safeUser.smtp_config.signature_image) || "",
        logo: safeUser.logo || (safeUser.smtp_config && safeUser.smtp_config.logo) || ""
      });
    } else {
      // Local update
      const userIndex = localUsers.findIndex(u => u.id === userId);
      localUsers[userIndex].smtp_config = newSmtpConfig;
      if (signature !== undefined) localUsers[userIndex].signature = signature;
      if (password) localUsers[userIndex].password = updates.password;
      
      const { password: _, ...safeUser } = localUsers[userIndex];
      res.json({
        ...safeUser,
        smtpConfig: safeUser.smtp_config,
        signatureImage: safeUser.signature_image || (safeUser.smtp_config && safeUser.smtp_config.signature_image) || "",
        logo: safeUser.logo || (safeUser.smtp_config && safeUser.smtp_config.logo) || ""
      });
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

  // --- Template Routes ---

  // Get all templates for user
  app.get("/api/templates", authenticateToken, async (req: any, res) => {
    if (supabase) {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });
      
      if (error) return res.status(500).json({ error: error.message });
      res.json(data || []);
    } else {
      res.json([]); // Fallback for local mode
    }
  });

  // Save new template
  app.post("/api/templates", authenticateToken, async (req: any, res) => {
    const { name, subject, body } = req.body;
    if (!name) return res.status(400).json({ error: "El nombre es obligatorio" });

    if (supabase) {
      const { data, error } = await supabase
        .from('email_templates')
        .insert([{ user_id: req.user.id, name, subject, body }])
        .select()
        .single();
      
      if (error) return res.status(500).json({ error: error.message });
      res.json(data);
    } else {
      res.status(501).json({ error: "No disponible en modo local" });
    }
  });

  // Delete template
  app.delete("/api/templates/:id", authenticateToken, async (req: any, res) => {
    if (supabase) {
      const { error } = await supabase
        .from('email_templates')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);
      
      if (error) return res.status(500).json({ error: error.message });
      res.json({ message: "Plantilla eliminada" });
    } else {
      res.sendStatus(501);
    }
  });

  // --- Email Routes ---

  // Test SMTP connection
  app.post("/api/test-smtp", authenticateToken, async (req: any, res) => {
    const { host, port, user, pass, from } = req.body;

    if (!host || !user || !pass) {
      return res.status(400).json({ error: "Faltan datos de configuración" });
    }

    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port || "587"),
      secure: port === "465",
      auth: { user, pass },
    });

    // Format sender correctly
    let sender = user;
    if (from) {
      if (from.includes('<')) {
        sender = from;
      } else {
        sender = `"${from}" <${user}>`;
      }
    }

    try {
      await transporter.verify();
      
      // Send a real test email to the user themselves
      await transporter.sendMail({
        from: sender,
        to: user, 
        subject: "MailPulse Orange - Prueba de Conexión",
        text: "Si recibes este correo, tu configuración SMTP es correcta y la entrega funciona.",
        html: "<p>Si recibes este correo, tu configuración SMTP es <strong>correcta</strong> y la entrega funciona.</p>"
      });

      res.json({ message: "Conexión establecida y correo de prueba enviado a tu bandeja de entrada." });
    } catch (error: any) {
      console.error("SMTP Test Error:", error);
      res.status(500).json({ error: error.message || "Error al conectar con el servidor SMTP" });
    }
  });

  // Email sending endpoint
  app.post("/api/send-emails", authenticateToken, async (req: any, res) => {
    const { recipients, template, signatureImage, logo, personalizedPreviews } = req.body;

    try {
      const user = await findUserById(req.user.id);
      if (!user) return res.sendStatus(403);

      const smtpConfig = user.smtp_config || {};
      const signature = user.signature || '';

      if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass) {
        return res.status(400).json({ error: "Configuración SMTP incompleta en el servidor" });
      }

      if (!recipients || !template) {
        return res.status(400).json({ error: "Faltan destinatarios o plantilla" });
      }

      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: parseInt(smtpConfig.port || "587"),
        secure: smtpConfig.port === "465",
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.pass,
        },
      });

      let sender = smtpConfig.user;
      let replyToAddress = smtpConfig.user;
      
      if (smtpConfig.from) {
        if (smtpConfig.from.includes('<')) {
          sender = smtpConfig.from;
          const match = smtpConfig.from.match(/<([^>]+)>/);
          if (match) {
            replyToAddress = match[1];
          }
        } else if (smtpConfig.from.includes('@')) {
          sender = smtpConfig.from;
          replyToAddress = smtpConfig.from;
        } else {
          sender = `"${smtpConfig.from}" <${smtpConfig.user}>`;
        }
      }

      const results = [];
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const targetEmail = recipient.email || recipient.Email || recipient.Correo || recipient.correo || recipient.CORREO;
        
        if (!targetEmail) {
          results.push({ email: "Desconocido", status: "failed", error: "No se encontró email" });
          continue;
        }

        try {
          let personalizedBody = template.body;
          let personalizedSubject = template.subject;

          // Use AI personalized preview if available for this recipient
          if (personalizedPreviews && personalizedPreviews[i]) {
            contentBody = personalizedPreviews[i].body;
            personalizedSubject = personalizedPreviews[i].subject;
          } else {
            contentBody = template.body;
            personalizedSubject = template.subject;
          }

          const fullHtmlLogo = logo ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${logo}" alt="Logo" style="max-width: 200px;"></div>` : '';
          
          const attachments: any[] = [];
          
          if (signature || signatureImage) {
            contentBody += `<br><br><div class="signature" style="border-top: 1px solid #eee; pt-4; mt-4;">`;
            if (signature) {
              contentBody += `<div style="color: #666; font-size: 14px;">${signature}</div>`;
            }
            if (signatureImage && signatureImage.startsWith('data:image/')) {
              const [meta, data] = signatureImage.split(',');
              const mimeMatch = meta.match(/:(.*?);/);
              const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
              const extension = mimeType.split('/')[1] || 'png';
              
              attachments.push({
                filename: `signature.${extension}`,
                content: data,
                encoding: 'base64',
                cid: 'signature_image_cid'
              });
              
              contentBody += `<br><img src="cid:signature_image_cid" alt="Firma" style="width: 100%; max-width: 100%; height: auto; margin-top: 10px; display: block;">`;
            } else if (signatureImage) {
              contentBody += `<br><img src="${signatureImage}" alt="Firma" style="width: 100%; max-width: 100%; height: auto; margin-top: 10px; display: block;">`;
            }
            contentBody += `</div>`;
          }

          contentBody += `<br><br><div style="text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 10px;">
            <p>Este correo se ha enviado a ${targetEmail}. Si no deseas recibir más correos, puedes <a href="{{unsubscribe_link}}">darte de baja aquí</a>.</p>
          </div>`;

          // Run placeholder replacement on the body (including footer)
          contentBody = contentBody.replace(/{{\s*([^}]+)\s*}}/g, (match, p1) => {
            const key = p1.trim().toLowerCase();
            if (key === 'unsubscribe_link') return match;
            const matchingKey = Object.keys(recipient).find(k => k.trim().toLowerCase() === key);
            return matchingKey ? (recipient[matchingKey] || '') : '';
          });
          personalizedSubject = personalizedSubject.replace(/{{\s*([^}]+)\s*}}/g, (match, p1) => {
            const key = p1.trim().toLowerCase();
            if (key === 'unsubscribe_link') return match;
            const matchingKey = Object.keys(recipient).find(k => k.trim().toLowerCase() === key);
            return matchingKey ? (recipient[matchingKey] || '') : '';
          });

          const fullHtml = `
            <!DOCTYPE html>
            <html lang="es">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${personalizedSubject}</title>
              </head>
              <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1a; background-color: #ffffff;">
                <div style="max-width: 600px; margin: 0 auto;">
                  ${fullHtmlLogo}
                  ${contentBody}
                </div>
              </body>
            </html>
          `.trim();

          const plainText = contentBody.replace(/<[^>]*>?/gm, '').trim();

          const info = await transporter.sendMail({
            from: sender,
            to: targetEmail,
            replyTo: replyToAddress,
            subject: personalizedSubject,
            html: fullHtml,
            text: plainText,
            attachments: attachments.length > 0 ? attachments : undefined,
            messageId: `<${Date.now()}.${Math.random().toString(36).substring(2)}@mailpulse.orange>`,
            headers: {
              'X-Mailer': 'MailPulse Orange v2.0',
              'X-Priority': '3',
            }
          });

          results.push({ 
            email: targetEmail, 
            status: "sent", 
            messageId: info.messageId,
            response: info.response 
          });
        } catch (error: any) {
          results.push({ 
            email: targetEmail, 
            status: "failed", 
            error: error.message || "Error desconocido" 
          });
        }
      }
      res.json({ results });
    } catch (error: any) {
      console.error("Error fatal en /api/send-emails:", error);
      res.status(500).json({ error: "Error interno del servidor al procesar la solicitud." });
    }
  });

  return app;
}
