import express from "express";
import Drivers from "../models/Drivers.js";
import authenticate from "../middlewares/auth.js";
const router = express.Router();

// Create - POST /drivers
router.post("/drivers", authenticate, async (req, res) => {
  try {
    const { name, status, observation, phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "O telefone é obrigatório" });
    }

    const establishment = req.user.establishment;
    const usersId = establishment; // usersId é o mesmo que establishment

    const driver = await Drivers.create({
      usersId,
      name,
      status,
      establishment,
      observation,
      phone,
    });

    res.status(201).json(driver);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Read All - GET /drivers
router.get("/drivers", authenticate, async (req, res) => {
  try {
    const drivers = await Drivers.findAll();
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Read One - GET /drivers/:id
router.get("/drivers/:id", authenticate, async (req, res) => {
  try {
    const driver = await Drivers.findByPk(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Motorista não encontrado" });
    }
    res.json(driver);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update - PUT /drivers/:id
router.put("/drivers/:id", authenticate, async (req, res) => {
  try {
    const { name, status, observation, phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "O telefone é obrigatório" });
    }

    const establishment = req.user.establishment;
    const usersId = establishment; // usersId é o mesmo que establishment

    const driver = await Drivers.findByPk(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Motorista não encontrado" });
    }

    await driver.update({
      usersId,
      name,
      status,
      establishment,
      observation,
      phone,
    });

    res.json(driver);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete - DELETE /drivers/:id
router.delete("/drivers/:id", authenticate, async (req, res) => {
  try {
    const driver = await Drivers.findByPk(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Motorista não encontrado" });
    }

    await driver.destroy();
    res.json({ message: "Motorista removido com sucesso" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
