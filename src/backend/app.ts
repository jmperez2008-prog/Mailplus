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
      logo: u.logo || (u.smtp_config && u.smtp_config.logo) || "",
      sent_emails_count: (u.smtp_config && u.smtp_config.sent_emails_count) || 0
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
  app.get("/api/email-history", authenticateToken, async (req: any, res) => {
    if (supabase) {
      const { data, error } = await supabase
        .from('email_history')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });
      
      if (error) return res.status(500).json({ error: error.message });
      res.json(data);
    } else {
      res.status(501).json({ error: "No disponible en modo local" });
    }
  });

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
    let replyToAddress = user;
    if (from) {
      if (from.includes('<')) {
        const match = from.match(/<([^>]+)>/);
        if (match) {
          replyToAddress = match[1];
        }
      } else if (from.includes('@')) {
        replyToAddress = from;
      }
    }
    const sender = `"Orange Empresas" <${replyToAddress}>`;

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

      let replyToAddress = smtpConfig.user;
      
      if (smtpConfig.from) {
        if (smtpConfig.from.includes('<')) {
          const match = smtpConfig.from.match(/<([^>]+)>/);
          if (match) {
            replyToAddress = match[1];
          }
        } else if (smtpConfig.from.includes('@')) {
          replyToAddress = smtpConfig.from;
        }
      }

      const sender = `"Orange Empresas" <${replyToAddress}>`;

      const results = [];
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const targetEmail = recipient.email || recipient.Email || recipient.Correo || recipient.correo || recipient.CORREO;
        
        if (!targetEmail) {
          results.push({ email: "Desconocido", status: "failed", error: "No se encontró email" });
          continue;
        }

        try {
          let personalizedSubject = template.subject;
          let contentBody = '';

          // Use AI personalized preview if available for this recipient
          if (personalizedPreviews && personalizedPreviews[i]) {
            contentBody = personalizedPreviews[i].body;
            personalizedSubject = personalizedPreviews[i].subject;
          } else {
            contentBody = template.body;
            personalizedSubject = template.subject;
          }

          const fullHtmlLogo = logo ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${logo}" alt="Logo" width="200" style="max-width: 200px; width: 100%; height: auto; border: 0; outline: none; text-decoration: none;"></div>` : '';
          
          const attachments: any[] = [];
          
          if (signature || signatureImage) {
            contentBody += `<br><br><div class="signature" style="border-top: 1px solid #eee; padding-top: 16px; margin-top: 16px;">`;
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
              
              contentBody += `<br><img src="cid:signature_image_cid" alt="Firma" width="400" style="max-width: 100%; height: auto; margin-top: 10px; display: block; border: 0; outline: none; text-decoration: none;">`;
            } else if (signatureImage) {
              contentBody += `<br><img src="${signatureImage}" alt="Firma" width="400" style="max-width: 100%; height: auto; margin-top: 10px; display: block; border: 0; outline: none; text-decoration: none;">`;
            }
            contentBody += `</div>`;
          }

          contentBody += `<br><br><div style="text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 10px;">
            <p>
              <a href="{{sender_email}}" style="background-color: #FF7900; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; mso-padding-alt: 0; text-underline-color: #FF7900;"><!--[if mso]><i style="letter-spacing: 20px; mso-font-width: -100%; mso-text-raise: 20pt;">&nbsp;</i><![endif]--><span style="mso-text-raise: 10pt;">Responder</span><!--[if mso]><i style="letter-spacing: 20px; mso-font-width: -100%;">&nbsp;</i><![endif]--></a>
            </p>
            <p>Este correo se ha enviado a ${targetEmail}. Si no deseas recibir más correos, puedes <a href="{{unsubscribe_link}}">darte de baja aquí</a>.</p>
          </div>`;

          // Ensure the sender_email link has the subject line
          contentBody = contentBody.replace(/href=["']\{\{\s*sender_email\s*\}\}["']/gi, 'href="mailto:{{sender_email}}?subject=Estoy%20interesado%20en%20Orange!!!"');

          contentBody = contentBody.replace(/{{\s*([^}]+)\s*}}/g, (match, p1) => {
            const key = p1.trim().toLowerCase();
            if (key === 'unsubscribe_link') {
              return `mailto:${replyToAddress}?subject=Baja%20de%20comunicaciones&body=Por%20favor,%20dame%20de%20baja%20de%20esta%20lista%20de%20correo.%20Mi%20email%20es:%20${targetEmail}`;
            }
            if (key === 'sender_email') {
              return replyToAddress;
            }
            const matchingKey = Object.keys(recipient).find(k => k.trim().toLowerCase() === key);
            return matchingKey ? (recipient[matchingKey] || '') : '';
          });

          // Fix hrefs that contain the email address to ensure they are valid mailto: links
          contentBody = contentBody.replace(/href=["']([^"']+)["']/gi, (match, url) => {
            const cleanUrl = url.trim();
            const cleanReplyTo = replyToAddress.trim();
            if (cleanUrl === cleanReplyTo || cleanUrl.toLowerCase().replace(/\s+/g, '') === `mailto:${cleanReplyTo.toLowerCase()}`) {
              return `href="mailto:${cleanReplyTo}?subject=Estoy%20interesado%20en%20Orange!!!"`;
            }
            return match;
          });
          personalizedSubject = personalizedSubject.replace(/{{\s*([^}]+)\s*}}/g, (match, p1) => {
            const key = p1.trim().toLowerCase();
            if (key === 'unsubscribe_link') return '';
            const matchingKey = Object.keys(recipient).find(k => k.trim().toLowerCase() === key);
            return matchingKey ? (recipient[matchingKey] || '') : '';
          });

          const fullHtml = `
            <!DOCTYPE html>
            <html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="X-UA-Compatible" content="IE=edge">
                <title>${personalizedSubject}</title>
                <!--[if mso]>
                <style type="text/css">
                  body, table, td, p, a, li, blockquote {font-family: Arial, sans-serif !important;}
                </style>
                <![endif]-->
              </head>
              <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1a; background-color: #ffffff; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
                <center style="width: 100%; background-color: #ffffff;">
                  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <!--[if mso]>
                    <table align="center" role="presentation" cellspacing="0" cellpadding="0" border="0" width="600">
                    <tr>
                    <td style="padding: 20px;">
                    <![endif]-->
                    
                    ${fullHtmlLogo}
                    ${contentBody}
                    
                    <!--[if mso]>
                    </td>
                    </tr>
                    </table>
                    <![endif]-->
                  </div>
                </center>
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
          if (supabase) {
            await supabase.from('email_history').insert([{
              user_id: user.id,
              recipient_email: targetEmail,
              recipient_data: recipient,
              status: "sent",
              error: null
            }]);
          }
        } catch (error: any) {
          results.push({ 
            email: targetEmail, 
            status: "failed", 
            error: error.message || "Error desconocido" 
          });
          if (supabase) {
            await supabase.from('email_history').insert([{
              user_id: user.id,
              recipient_email: targetEmail,
              recipient_data: recipient,
              status: "failed",
              error: error.message || "Error desconocido"
            }]);
          }
        }
      }

      // Update sent_emails_count
      const successCount = results.filter(r => r.status === "sent").length;
      if (successCount > 0) {
        const currentSmtpConfig = user.smtp_config || {};
        const newCount = (currentSmtpConfig.sent_emails_count || 0) + successCount;
        const newSmtpConfig = { ...currentSmtpConfig, sent_emails_count: newCount };
        
        if (supabase) {
          await supabase.from('app_users').update({ smtp_config: newSmtpConfig }).eq('id', user.id);
        } else {
          const localUser = localUsers.find(u => u.id === user.id);
          if (localUser) {
            localUser.smtp_config = newSmtpConfig;
            localUser.smtpConfig = newSmtpConfig;
          }
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
