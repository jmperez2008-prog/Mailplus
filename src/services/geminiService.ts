import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generatePersonalizedEmail(
  template: string,
  recipientData: any,
  context: string
) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Actúa como un experto en marketing por correo electrónico para Orange (distribuidor oficial de telefonía).
    Tengo la siguiente plantilla de correo:
    "${template}"

    Y los siguientes datos del destinatario:
    ${JSON.stringify(recipientData)}

    Contexto adicional de la campaña:
    "${context}"

    Tu tarea es reescribir el correo para que sea altamente personalizado, profesional y persuasivo.
    IMPORTANTE: Usa un estilo visual coherente con la marca Orange. 
    Usa colores corporativos: Naranja (#FF7900) para botones o enlaces importantes, y Negro para el texto principal.
    Mantén el tono profesional pero cercano, típico de un asesor de Orange.
    Devuelve el resultado en formato JSON con los campos "subject" (asunto) y "body" (cuerpo en HTML).
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING },
          },
          required: ["subject", "body"],
        },
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Error generating email with Gemini:", error);
    return null;
  }
}

export async function generateDraftTemplate(goal: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Crea una plantilla de correo electrónico profesional para el siguiente objetivo: "${goal}".
    El estilo debe ser corporativo de Orange (somos distribuidores oficiales).
    Usa variables entre llaves dobles como {{nombre}}, {{empresa}}, {{cargo}} para las partes que deban ser personalizadas.
    Incluye una estructura HTML limpia con acentos en color naranja (#FF7900).
    Devuelve un JSON con "subject" y "body" (HTML básico).
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING },
          },
          required: ["subject", "body"],
        },
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Error generating template with Gemini:", error);
    return null;
  }
}
