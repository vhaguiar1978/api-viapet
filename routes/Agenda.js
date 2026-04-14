import express from "express";
import Settings from "../models/Settings.js";
import authenticate from "../middlewares/auth.js";
import owner from "../middlewares/owner.js";

const router = express.Router();

router.get("/agenda/settings", authenticate, async (req, res) => {
  try {
    const userId = req.user.establishment;
    const settings = await Settings.findOne({
      where: { usersId: userId },
      attributes: [
        "intervalClinic",
        "intervalAesthetics",
        "notifyClient",
        "openingTime",
        "closingTime",
        "breakStartTime",
        "breakEndTime",
        "workingDays",
      ],
    });

    if (!settings) {
      return res.status(404).json({
        message: "Configurações não encontradas",
      });
    }

    return res.status(200).json({
      message: "Configurações encontradas com sucesso",
      data: settings,
    });
  } catch (error) {
    console.error("Erro ao buscar configurações da agenda:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

router.post("/agenda/settings", authenticate, owner, async (req, res) => {
  try {
    const {
      intervalClinic,
      intervalAesthetics,
      notifyClient,
      openingTime,
      closingTime,
      breakStartTime,
      breakEndTime,
    } = req.body;
    const userId = req.user.establishment;

    if (
      intervalClinic === undefined &&
      intervalAesthetics === undefined &&
      notifyClient === undefined &&
      openingTime === undefined &&
      closingTime === undefined &&
      breakStartTime === undefined &&
      breakEndTime === undefined
    ) {
      return res.status(400).json({ message: "Nenhum dado fornecido" });
    }

    let settings = await Settings.findOne({ where: { usersId: userId } });

    if (!settings) {
      settings = await Settings.create({
        usersId: userId,
        intervalClinic: intervalClinic || 30,
        intervalAesthetics: intervalAesthetics || 30,
        notifyClient: notifyClient || false,
        openingTime: openingTime || "08:00:00",
        closingTime: closingTime || "18:00:00",
        breakStartTime: breakStartTime || "12:00:00",
        breakEndTime: breakEndTime || "13:00:00",
      });
      return res.status(201).json({
        message: "Configurações da agenda criadas com sucesso",
        data: settings,
      });
    }

    if (intervalClinic !== undefined) {
      if (!Number.isInteger(intervalClinic) || intervalClinic < 1) {
        return res.status(400).json({
          message: "Intervalo da clínica deve ser um número inteiro positivo",
        });
      }
      settings.intervalClinic = intervalClinic;
    }

    if (intervalAesthetics !== undefined) {
      if (!Number.isInteger(intervalAesthetics) || intervalAesthetics < 1) {
        return res.status(400).json({
          message: "Intervalo da estética deve ser um número inteiro positivo",
        });
      }
      settings.intervalAesthetics = intervalAesthetics;
    }

    if (notifyClient !== undefined) {
      if (typeof notifyClient !== "boolean") {
        return res.status(400).json({
          message: "notifyClient deve ser um valor booleano",
        });
      }
      settings.notifyClient = notifyClient;
    }

    if (openingTime !== undefined) {
      settings.openingTime = openingTime;
    }

    if (closingTime !== undefined) {
      settings.closingTime = closingTime;
    }

    if (breakStartTime !== undefined) {
      settings.breakStartTime = breakStartTime;
    }

    if (breakEndTime !== undefined) {
      settings.breakEndTime = breakEndTime;
    }

    await settings.save();
    return res.status(200).json({
      message: "Configurações da agenda atualizadas com sucesso",
      data: settings,
    });
  } catch (error) {
    console.error("Erro ao atualizar configurações da agenda:", error);
    return res.status(500).json({
      message: "Erro no servidor",
      error: error.message,
    });
  }
});

export default router;
