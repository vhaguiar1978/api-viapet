import express from "express";
import Services from "../models/Services.js";
import authenticate from "../middlewares/auth.js";
import { Op } from "sequelize";

const router = express.Router();

// Adicione esta rota de importação
router.post("/import", authenticate, async (req, res) => {
  try {
    const { services } = req.body;

    if (!services || !Array.isArray(services)) {
      return res.status(400).json({
        success: false,
        message: "Dados inválidos para importação",
      });
    }

    // Função para processar o valor monetário
    const parseMoneyValue = (value) => {
      if (!value) return 0;
      if (typeof value === "number") return value;
      return (
        Number(
          value
            .toString()
            .replace(/[^\d,.-]/g, "")
            .replace(",", "."),
        ) || 0
      );
    };

    // Função para processar o tipo de serviço
    const processServiceType = (type) => {
      const normalizedType = type?.trim() || "";
      switch (normalizedType) {
        case "Procedimentos":
          return "Clínica";
        case "Estética":
        case "Estetica":
          return "Estética";
        case "Consultas":
          return "Clínica";
        default:
          return null;
      }
    };

    // Processa os serviços
    const processedServices = services
      .map((service) => {
        try {
          const type = processServiceType(service.Tipo);
          console.log("Tipo original:", service.Tipo, "Tipo processado:", type); // Debug
          // Ignora serviços que não são do tipo Clínica ou Estética
          if (!type) return null;

          return {
            establishment: req.user.establishment,
            name: service.Servico || "",
            category: type, // Será 'Clinica' ou 'Estética'
            cost: parseMoneyValue(service.Custo),
            price: parseMoneyValue(service.Valor),
            duration: 30, // Duração padrão de 30 minutos
            description: "",
            observation: "",
          };
        } catch (error) {
          console.error("Erro ao processar serviço:", error);
          console.error("Dados do serviço:", service); // Debug
          return null;
        }
      })
      .filter((service) => service !== null && service.name);

    if (processedServices.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nenhum serviço válido para importação",
      });
    }

    // Importa os serviços
    const results = await Promise.allSettled(
      processedServices.map((service) =>
        Services.create(service).catch((error) => {
          console.error("Erro ao criar serviço:", error);
          return null;
        }),
      ),
    );

    // Conta sucessos e falhas
    const imported = results.filter(
      (r) => r.status === "fulfilled" && r.value,
    ).length;
    const failed = processedServices.length - imported;

    return res.status(200).json({
      success: true,
      message: `${imported} serviços importados com sucesso${failed > 0 ? `. ${failed} falharam.` : ""}`,
      importedCount: imported,
      failedCount: failed,
    });
  } catch (error) {
    console.error("Erro ao importar serviços:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao importar serviços",
      error: error.message,
    });
  }
});

export default router;
