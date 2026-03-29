import express from "express";
import Users from "../models/Users.js";
import authenticate from "../middlewares/auth.js";

const router = express.Router();

router.get("/employees", authenticate, async (req, res) => {
  const establishmentId = req.user.establishment;
  if (!establishmentId) {
    return res.status(400).json({ message: "Estabelecimento não informado" });
  }
  const establishment = await Users.findAll({
    where: { establishment: establishmentId, role: "funcionario" },
    attributes: ["id", "name", "email", "createdAt", "status"],
  });
  return res.status(200).json(establishment);
});

export default router;
