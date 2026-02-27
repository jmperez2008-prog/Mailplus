
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { 
  Mail, 
  Upload, 
  FileText, 
  Send, 
  Settings, 
  Users, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Sparkles,
  ChevronRight,
  Trash2,
  Eye,
  EyeOff,
  Layout,
  LogOut,
  Shield
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { generateDraftTemplate, generatePersonalizedEmail } from './services/geminiService';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import { User, AuthResponse, SMTPConfig } from './types/auth';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Recipient = Record<string, any>;

interface EmailTemplate {
  subject: string;
  body: string;
}

export default function App() {
  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // App State
  const [step, setStep] = useState(1);
  const [entryMode, setEntryMode] = useState<'bulk' | 'manual'>('bulk');
  const [manualRecipient, setManualRecipient] = useState<Recipient>({ Nombre: '', Email: '', Empresa: '' });
  const [aiExplanation, setAiExplanation] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [template, setTemplate] = useState<EmailTemplate>({ subject: '', body: '' });
  const [logo, setLogo] = useState<string | null>(null);
  
  // Settings State (Loaded from backend)
  const [smtpConfig, setSmtpConfig] = useState<SMTPConfig>({
    host: '',
    port: '587',
    user: '',
    pass: '',
    from: ''
  });
  const [signature, setSignature] = useState('');
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendResults, setSendResults] = useState<{ email: string; status: string; error?: string }[]>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [personalizedPreviews, setPersonalizedPreviews] = useState<Record<number, EmailTemplate>>({});

  // Load user settings when logged in
  useEffect(() => {
    if (user && user.smtpConfig) {
      setSmtpConfig(user.smtpConfig);
    }
    if (user && user.signature) {
      setSignature(user.signature);
    }
    if (user && user.signatureImage) {
      setSignatureImage(user.signatureImage);
    }
    if (user && user.logo) {
      setLogo(user.logo);
    }
  }, [user]);

  const handleLogin = (data: AuthResponse) => {
    setUser(data.user);
    setToken(data.token);
    setStep(1);
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    setRecipients([]);
    setTemplate({ subject: '', body: '' });
    setLogo(null);
    setSignatureImage(null);
  };

  const handleSaveSettings = async () => {
    if (!user || !token) return;
    setIsSavingSettings(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ smtpConfig, signature, signatureImage, logo })
      });
      
      if (res.ok) {
        const updatedUser = await res.json();
        setUser(updatedUser);
        alert('Configuración guardada correctamente');
      } else {
        alert('Error al guardar la configuración');
      }
    } catch (e) {
      console.error(e);
      alert('Error de conexión');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTestSmtp = async () => {
    if (!token) return;
    setIsTestingSmtp(true);
    try {
      const res = await fetch('/api/test-smtp', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(smtpConfig)
      });
      
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Conexión SMTP exitosa');
      } else {
        alert('Error SMTP: ' + (data.error || 'Error desconocido'));
      }
    } catch (e) {
      console.error(e);
      alert('Error de conexión al servidor');
    } finally {
      setIsTestingSmtp(false);
    }
  };

  // File Upload Handling
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);
      setRecipients(json as Recipient[]);
      setStep(2);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv']
    },
    multiple: false
  });

  const handleGenerateTemplate = async () => {
    const goal = prompt("¿Cuál es el objetivo de tu correo? (ej: Oferta fibra y móvil, Renovación terminales)");
    if (!goal) return;

    setIsGenerating(true);
    const result = await generateDraftTemplate(`${goal}. El estilo debe ser corporativo de Orange (distribuidor oficial), usando colores naranja (#FF7900) y negro. Incluye un placeholder para el logotipo.`);
    if (result) {
      setTemplate(result);
    }
    setIsGenerating(false);
  };

  const handleGenerateIndividualEmail = async () => {
    if (!manualRecipient.Email || !aiExplanation) {
      alert("Por favor, introduce al menos el email y una explicación para la IA.");
      return;
    }

    setIsGenerating(true);
    const result = await generatePersonalizedEmail(
      `Genera un correo profesional de Orange basado en esta petición: ${aiExplanation}`,
      manualRecipient,
      "Contacto individual personalizado"
    );
    
    if (result) {
      setTemplate(result);
      setRecipients([manualRecipient]);
      setStep(3); // Go straight to preview
    }
    setIsGenerating(false);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setLogo(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePreviewPersonalization = async (index: number) => {
    if (personalizedPreviews[index]) return;
    
    setIsGenerating(true);
    const result = await generatePersonalizedEmail(
      template.body, 
      recipients[index], 
      "Campaña profesional de email marketing"
    );
    if (result) {
      setPersonalizedPreviews(prev => ({ ...prev, [index]: result }));
    }
    setIsGenerating(false);
  };

  const handleSendEmails = async () => {
    if (!smtpConfig.user || !smtpConfig.host) {
      alert("Por favor, configura los detalles de SMTP en la pestaña de ajustes.");
      setStep(4);
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch('/api/send-emails', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          recipients,
          template: {
            ...template,
            body: logo ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${logo}" alt="Logo" style="max-width: 200px;"></div>${template.body}` : template.body
          },
          signatureImage: signatureImage
        })
      });
      const data = await response.json();
      setSendResults(data.results);
      setStep(5);
    } catch (error) {
      console.error("Error sending emails:", error);
      alert("Error al enviar los correos. Revisa la consola.");
    } finally {
      setIsSending(false);
    }
  };

  const handleSignatureImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSignatureImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const currentPreview = useMemo(() => {
    const base = personalizedPreviews[activePreviewIndex] || template;
    let body = base.body;
    
    if (logo) {
      body = `<div style="text-align: center; margin-bottom: 20px;"><img src="${logo}" alt="Logo" style="max-width: 200px;"></div>${body}`;
    }
    
    // Preview signature
    if (signature || signatureImage) {
      body += `<br><br><div class="signature">`;
      if (signature) body += `${signature}`;
      if (signatureImage) body += `<br><img src="${signatureImage}" alt="Firma" style="max-width: 300px; margin-top: 10px;">`;
      body += `</div>`;
    }

    return { ...base, body };
  }, [activePreviewIndex, personalizedPreviews, template, logo, signature, signatureImage]);

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans">
      {/* Sidebar Navigation */}
      <nav className="fixed left-0 top-0 h-full w-64 bg-white border-r border-slate-200 p-6 z-10 flex flex-col">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-10 h-10 bg-[#FF7900] rounded-xl flex items-center justify-center text-white shadow-lg shadow-orange-200">
            <Mail size={24} />
          </div>
          <h1 className="font-bold text-xl tracking-tight">MailPulse <span className="text-[#FF7900]">Orange</span></h1>
        </div>

        <div className="space-y-2 flex-1">
          {[
            { id: 1, label: 'Destinatarios', icon: Users },
            { id: 2, label: 'Diseñar Plantilla', icon: Layout },
            { id: 3, label: 'Previsualizar', icon: Eye },
            { id: 4, label: 'Configuración', icon: Settings },
            { id: 5, label: 'Estado de Envío', icon: Send },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setStep(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
                step === item.id 
                  ? "bg-orange-50 text-orange-700 shadow-sm" 
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              )}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}

          {user.role === 'admin' && (
            <button
              onClick={() => setStep(6)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium",
                step === 6
                  ? "bg-indigo-50 text-indigo-700 shadow-sm" 
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              )}
            >
              <Shield size={18} />
              Administración
            </button>
          )}
        </div>

        <div className="mt-auto pt-6 border-t border-slate-100">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{user.username}</p>
              <p className="text-xs text-slate-500 truncate capitalize">{user.role}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all text-sm font-medium"
          >
            <LogOut size={16} />
            Cerrar Sesión
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="ml-64 p-10 max-w-6xl">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight mb-2">Destinatarios</h2>
                  <p className="text-slate-500">Elige cómo quieres añadir los contactos para tu campaña.</p>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button 
                    onClick={() => setEntryMode('bulk')}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                      entryMode === 'bulk' ? "bg-white text-orange-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    Carga Masiva
                  </button>
                  <button 
                    onClick={() => setEntryMode('manual')}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                      entryMode === 'manual' ? "bg-white text-orange-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    Individual
                  </button>
                </div>
              </div>

              {entryMode === 'bulk' ? (
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-3xl p-20 flex flex-col items-center justify-center transition-all cursor-pointer",
                    isDragActive ? "border-orange-500 bg-orange-50/50" : "border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-6">
                    <Upload size={32} />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Arrastra tu archivo aquí</h3>
                  <p className="text-slate-400 text-sm mb-8">Soporta .xlsx, .xls y .csv</p>
                  <button className="px-6 py-3 bg-[#FF7900] text-white rounded-xl font-medium shadow-lg shadow-orange-200 hover:bg-orange-600 transition-colors">
                    Seleccionar Archivo
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nombre Completo</label>
                      <input 
                        type="text"
                        value={manualRecipient.Nombre}
                        onChange={(e) => setManualRecipient({ ...manualRecipient, Nombre: e.target.value })}
                        placeholder="Juan Pérez"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Correo Electrónico</label>
                      <input 
                        type="email"
                        value={manualRecipient.Email}
                        onChange={(e) => setManualRecipient({ ...manualRecipient, Email: e.target.value })}
                        placeholder="juan@empresa.com"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Empresa</label>
                      <input 
                        type="text"
                        value={manualRecipient.Empresa}
                        onChange={(e) => setManualRecipient({ ...manualRecipient, Empresa: e.target.value })}
                        placeholder="Tech Solutions S.L."
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">¿Qué quieres decirle? (Explicación para la IA)</label>
                    <textarea 
                      value={aiExplanation}
                      onChange={(e) => setAiExplanation(e.target.value)}
                      placeholder="Ej: Quiero ofrecerle un descuento del 20% en fibra óptica porque su contrato actual está por vencer..."
                      className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 transition-all font-sans text-sm"
                    />
                  </div>

                  <div className="flex justify-end gap-3">
                    <button 
                      onClick={() => {
                        setManualRecipient({ Nombre: '', Email: '', Empresa: '' });
                        setAiExplanation('');
                      }}
                      className="px-6 py-3 text-slate-500 font-medium hover:text-slate-700 transition-all"
                    >
                      Limpiar
                    </button>
                    <button 
                      onClick={handleGenerateIndividualEmail}
                      disabled={isGenerating}
                      className="flex items-center gap-2 px-8 py-3 bg-[#FF7900] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-orange-600 disabled:opacity-50 transition-all"
                    >
                      {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                      Generar Correo Individual
                    </button>
                  </div>
                </div>
              )}

              {recipients.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="p-4 border-bottom border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-700">{recipients.length} Destinatarios cargados</span>
                    <button onClick={() => setRecipients([])} className="text-red-500 hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          {Object.keys(recipients[0]).map(key => (
                            <th key={key} className="px-4 py-3 font-semibold text-slate-600">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {recipients.slice(0, 10).map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50/50">
                            {Object.values(r).map((val: any, j) => (
                              <td key={j} className="px-4 py-3 text-slate-500 truncate max-w-[200px]">{String(val)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex justify-between items-end">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight mb-2">Diseñar Plantilla</h2>
                  <p className="text-slate-500">Crea el contenido de tu correo. Usa {"{{variable}}"} para personalizar.</p>
                </div>
                <button 
                  onClick={handleGenerateTemplate}
                  disabled={isGenerating}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#FF7900] text-white rounded-xl font-medium shadow-lg shadow-orange-200 hover:bg-orange-600 disabled:opacity-50 transition-all"
                >
                  {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                  Generar con Estilo Orange
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Logotipo de Empresa</label>
                    <div className="flex flex-col items-center gap-4">
                      {logo ? (
                        <div className="relative group w-full aspect-video bg-slate-50 rounded-xl overflow-hidden border border-slate-100 flex items-center justify-center">
                          <img src={logo} alt="Logo preview" className="max-h-full object-contain p-2" />
                          <button 
                            onClick={() => setLogo(null)}
                            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <label className="w-full aspect-video border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:bg-slate-50 hover:border-orange-300 cursor-pointer transition-all">
                          <Upload size={24} className="mb-2" />
                          <span className="text-xs font-medium">Subir Logo</span>
                          <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                        </label>
                      )}
                      <p className="text-[10px] text-slate-400 text-center">Se incluirá automáticamente al principio de cada correo.</p>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Asunto del Correo</label>
                    <input 
                      type="text"
                      value={template.subject}
                      onChange={(e) => setTemplate({ ...template, subject: e.target.value })}
                      placeholder="Ej: Hola {{Nombre}}, tenemos algo para ti"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Cuerpo del Correo (HTML)</label>
                    <textarea 
                      value={template.body}
                      onChange={(e) => setTemplate({ ...template, body: e.target.value })}
                      placeholder="Escribe tu mensaje aquí..."
                      className="w-full h-96 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4">
                <button 
                  onClick={() => setStep(3)}
                  className="px-8 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  Siguiente: Previsualizar
                  <ChevronRight size={18} />
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div>
                <h2 className="text-3xl font-bold tracking-tight mb-2">Previsualización de Campaña</h2>
                <p className="text-slate-500">Revisa cómo se verá cada correo antes de enviarlo.</p>
              </div>

              <div className="grid grid-cols-12 gap-8">
                <div className="col-span-4 space-y-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-2">Destinatarios</h3>
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm max-h-[500px] overflow-y-auto">
                    {recipients.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => setActivePreviewIndex(i)}
                        className={cn(
                          "w-full text-left p-4 border-b border-slate-100 transition-all flex items-center justify-between group",
                          activePreviewIndex === i ? "bg-indigo-50" : "hover:bg-slate-50"
                        )}
                      >
                        <div className="truncate pr-4">
                          <p className="font-semibold text-sm text-slate-700 truncate">{r.Nombre || r.Name || 'Sin Nombre'}</p>
                          <p className="text-xs text-slate-400 truncate">{r.Email || r.Correo || 'Sin Email'}</p>
                        </div>
                        <ChevronRight size={16} className={cn("transition-all", activePreviewIndex === i ? "text-indigo-500 translate-x-1" : "text-slate-300")} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="col-span-8 space-y-4">
                  <div className="flex justify-between items-center px-2">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Vista Previa</h3>
                    <button 
                      onClick={() => handlePreviewPersonalization(activePreviewIndex)}
                      disabled={isGenerating}
                      className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1 bg-orange-50 px-3 py-1.5 rounded-lg transition-all"
                    >
                      {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Personalizar con IA este correo
                    </button>
                  </div>
                  
                  <div className="bg-white border border-slate-200 rounded-3xl shadow-xl overflow-hidden">
                    <div className="bg-slate-50 p-6 border-b border-slate-100">
                      <div className="flex items-center gap-4 mb-3">
                        <span className="text-xs font-bold text-slate-400 w-16">De:</span>
                        <span className="text-sm font-medium text-slate-700">{smtpConfig.from || smtpConfig.user || 'Configura tu remitente'}</span>
                      </div>
                      <div className="flex items-center gap-4 mb-3">
                        <span className="text-xs font-bold text-slate-400 w-16">Para:</span>
                        <span className="text-sm font-medium text-slate-700">{recipients[activePreviewIndex]?.Email || recipients[activePreviewIndex]?.Correo}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-bold text-slate-400 w-16">Asunto:</span>
                        <span className="text-sm font-bold text-[#FF7900]">{currentPreview.subject}</span>
                      </div>
                    </div>
                    <div className="p-8 min-h-[400px] prose prose-slate max-w-none">
                      <div dangerouslySetInnerHTML={{ __html: currentPreview.body }} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4">
                <button 
                  onClick={handleSendEmails}
                  disabled={isSending}
                  className="px-10 py-4 bg-[#FF7900] text-white rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-orange-600 disabled:opacity-50 transition-all flex items-center gap-3"
                >
                  {isSending ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                  Lanzar Campaña Ahora
                </button>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div>
                <h2 className="text-3xl font-bold tracking-tight mb-2">Configuración de Usuario</h2>
                <p className="text-slate-500">Configura tu servidor de correo y firma personal.</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm grid grid-cols-2 gap-8">
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-slate-800 border-b pb-2">Servidor SMTP</h3>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Host SMTP</label>
                    <input 
                      type="text"
                      value={smtpConfig.host}
                      onChange={(e) => setSmtpConfig({ ...smtpConfig, host: e.target.value })}
                      placeholder="smtp.gmail.com"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Puerto</label>
                    <input 
                      type="text"
                      value={smtpConfig.port}
                      onChange={(e) => setSmtpConfig({ ...smtpConfig, port: e.target.value })}
                      placeholder="587"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Nombre del Remitente</label>
                    <input 
                      type="text"
                      value={smtpConfig.from}
                      onChange={(e) => setSmtpConfig({ ...smtpConfig, from: e.target.value })}
                      placeholder="Tu Nombre <tu@email.com>"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-slate-800 border-b pb-2">Credenciales</h3>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Usuario / Email</label>
                    <input 
                      type="text"
                      value={smtpConfig.user}
                      onChange={(e) => setSmtpConfig({ ...smtpConfig, user: e.target.value })}
                      placeholder="tu@email.com"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Contraseña / App Password</label>
                    <div className="relative">
                      <input 
                        type={showSmtpPass ? "text" : "password"}
                        value={smtpConfig.pass}
                        onChange={(e) => setSmtpConfig({ ...smtpConfig, pass: e.target.value })}
                        placeholder="••••••••••••"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPass(!showSmtpPass)}
                        className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showSmtpPass ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                    <AlertCircle className="text-amber-500 shrink-0" size={20} />
                    <p className="text-xs text-amber-700 leading-relaxed">
                      Si usas Gmail, recuerda usar una "Contraseña de Aplicación".
                    </p>
                  </div>
                </div>

                <div className="col-span-2 space-y-6 border-t pt-6">
                  <h3 className="text-lg font-bold text-slate-800 border-b pb-2">Firma de Correo</h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Firma en Texto (HTML)</label>
                      <textarea 
                        value={signature}
                        onChange={(e) => setSignature(e.target.value)}
                        placeholder="<p>Saludos,<br><strong>Tu Nombre</strong></p>"
                        className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                      />
                      <p className="text-[10px] text-slate-400 mt-2">Se añadirá automáticamente al final de tus correos.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Firma en Imagen</label>
                      {signatureImage ? (
                        <div className="relative group w-full aspect-video bg-slate-50 rounded-xl overflow-hidden border border-slate-100 flex items-center justify-center">
                          <img src={signatureImage} alt="Signature preview" className="max-h-full object-contain p-2" />
                          <button 
                            onClick={() => setSignatureImage(null)}
                            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <label className="w-full aspect-video border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:bg-slate-50 hover:border-orange-300 cursor-pointer transition-all">
                          <Upload size={24} className="mb-2" />
                          <span className="text-xs font-medium">Subir Imagen</span>
                          <input type="file" className="hidden" accept="image/*" onChange={handleSignatureImageUpload} />
                        </label>
                      )}
                       <p className="text-[10px] text-slate-400 mt-2">Se añadirá después del texto de tu firma.</p>
                    </div>
                  </div>
                </div>

                <div className="col-span-2 flex justify-end gap-3">
                  <button 
                    onClick={handleTestSmtp}
                    disabled={isTestingSmtp || !smtpConfig.host || !smtpConfig.user}
                    className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 disabled:opacity-50 transition-all flex items-center gap-2"
                  >
                    {isTestingSmtp ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                    Probar Conexión
                  </button>
                  <button 
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="px-8 py-3 bg-[#FF7900] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-orange-600 disabled:opacity-50 transition-all flex items-center gap-2"
                  >
                    {isSavingSettings ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                    Guardar Configuración
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8 text-center py-12"
            >
              <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 size={48} />
              </div>
              <div>
                <h2 className="text-4xl font-bold tracking-tight mb-2">¡Campaña Finalizada!</h2>
                <p className="text-slate-500 text-lg">Se han procesado todos los correos de tu lista.</p>
              </div>

              <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
                <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-around">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-slate-900">{sendResults.filter(r => r.status === 'sent').length}</p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Enviados</p>
                  </div>
                  <div className="text-center">
                    <p className="text-3xl font-bold text-red-500">{sendResults.filter(r => r.status === 'failed').length}</p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Fallidos</p>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-6 py-4 font-semibold text-slate-600">Email</th>
                        <th className="px-6 py-4 font-semibold text-slate-600">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sendResults.map((result, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td className="px-6 py-4 text-slate-700 font-medium">
                            {result.email}
                            {result.error && (
                              <p className="text-[10px] text-red-400 font-normal mt-0.5">{result.error}</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {result.status === 'sent' ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                                <CheckCircle2 size={12} />
                                Éxito
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                                <AlertCircle size={12} />
                                Error
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button 
                onClick={() => {
                  setStep(1);
                  setSendResults([]);
                  setRecipients([]);
                }}
                className="px-8 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-all"
              >
                Nueva Campaña
              </button>
            </motion.div>
          )}

          {step === 6 && user.role === 'admin' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <AdminDashboard token={token!} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
