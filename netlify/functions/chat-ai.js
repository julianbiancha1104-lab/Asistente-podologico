// netlify/functions/chat-ai.js
// Clasificador de triage con IA (Groq) para Biopodología & Estética.
//
// IMPORTANTE — cómo funciona este archivo:
// En vez de dejar que la IA le responda directo al paciente con texto libre,
// la usamos como "traductora": lee lo que el paciente escribió y decide a
// cuál de las orientaciones YA REVISADAS por Margarita corresponde. El texto
// que ve el paciente sigue siendo siempre el mismo, aprobado de antemano
// (vive en index.html, en el objeto `renderers`).
//
// La única excepción es la categoría "otra": ahí sí la IA redacta una
// respuesta breve, con el mismo prompt de seguridad de siempre (nunca
// diagnostica, siempre deriva a la clínica).

exports.handler = async function (event, context) {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const body = JSON.parse(event.body || "{}");
        // Límite simple para evitar mensajes gigantes / abuso de la API.
        const userMessage = (body.message || "").toString().slice(0, 500);

        if (!userMessage.trim()) {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: "otra", reply: "Cuéntanos con más detalle qué síntoma o consulta tienes para poder orientarte mejor." })
            };
        }

        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Falta la clave de API de Groq en Netlify (GROQ_API_KEY)." })
            };
        }

        const systemPrompt = `Eres el clasificador del triage podológico de "Biopodología & Estética", la clínica de la Podóloga Clínica Margarita Portilla, en San Miguel, Chile.

Tu única tarea es leer el mensaje del paciente y clasificarlo en UNA de estas categorías exactas:

- "onico_leve": uña encarnada / dolor en el borde de la uña, leve, apenas se nota.
- "onico_moderado": uña encarnada que ya molesta o duele al caminar.
- "onico_severo": uña encarnada con pus, mucho enrojecimiento, o dolor intenso.
- "micosis_reciente": cambios de color/grosor/forma en la uña (hongos), de menos de 1 mes.
- "micosis_larga": cambios de uña de más de 1 mes, o el paciente no está seguro de hace cuánto.
- "diabetes_urgente": paciente diabético que menciona herida, úlcera, mancha oscura, o pérdida de sensibilidad en el pie.
- "diabetes_preventivo": paciente diabético que pide un control preventivo, sin señales de alarma.
- "estetica": consulta por estética podal, spa de pies, callosidades estéticas, tratamientos de belleza del pie.
- "otra": cualquier mensaje que no calce claramente con las categorías anteriores (saludos, preguntas administrativas, horarios, precios, dudas generales, etc).

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes ni después, con este formato exacto:
{"category": "<una_de_las_categorias_de_arriba>", "reply": null}

Si, y solo si, category es "otra", en vez de null, el campo "reply" debe contener una respuesta breve (máximo 2 párrafos cortos), cálida y profesional, en español, usando <strong> y <br> si hace falta para dar formato. Esa respuesta:
- Nunca debe dar un diagnóstico definitivo (usa frases como "esto podría estar relacionado con...").
- Nunca debe recomendar tratamientos caseros.
- Siempre debe terminar invitando a agendar una evaluación clínica presencial o a escribir por WhatsApp.
- Si el paciente pregunta algo fuera de temas podológicos o clínicos, redirige amablemente la conversación hacia la clínica, sin inventar información que no tienes (por ejemplo, no inventes horarios ni precios si no los conoces).`;

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
        ];

        // Modelo vigente en Groq (llama-3.3-70b-versatile se apaga el 16/08/2026).
        const model = "openai/gpt-oss-120b";

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.2,
                max_tokens: 400,
                response_format: { type: "json_object" }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Error desde Groq API:", data);
            return {
                statusCode: 200, // devolvemos 200 igual para que el frontend use su respaldo local
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ category: "otra", reply: null, error: data.error?.message || "Error al comunicarse con la IA." })
            };
        }

        const raw = data.choices?.[0]?.message?.content || "{}";
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            console.error("Respuesta de Groq no era JSON válido:", raw);
            parsed = null;
        }

        const validCategories = [
            "onico_leve", "onico_moderado", "onico_severo",
            "micosis_reciente", "micosis_larga",
            "diabetes_urgente", "diabetes_preventivo",
            "estetica", "otra"
        ];

        if (!parsed || !validCategories.includes(parsed.category)) {
            // Respaldo seguro si la IA no devolvió algo utilizable.
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    category: "otra",
                    reply: "Gracias por escribirnos. Para orientarte mejor, cuéntanos si se trata de una uña encarnada, hongos en la uña, cuidado de pie diabético o estética podal, o escríbenos directo por WhatsApp para una atención personalizada."
                })
            };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: parsed.category, reply: parsed.reply || null })
        };

    } catch (error) {
        console.error("Error en la función Serverless:", error);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Ocurrió un error en el servidor." })
        };
    }
};
