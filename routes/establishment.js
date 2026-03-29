import express from "express";
import Settings from "../models/Settings.js";
import authenticate from "../middlewares/auth.js";

const router = express.Router();

router.get("/establishment", authenticate, async (req, res) => {
  const establishmentId = req.user.establishment;
  const userId = req.user.id;
  if (!establishmentId) {
    return res.status(400).json({ message: "Estabelecimento não informado" });
  }
  const establishment = await Settings.findOne({
    where: { usersId: establishmentId },
    attributes: ["themeColor", "storeName", "logoUrl"],
  });
  return res.status(200).json(establishment);
});

export default router;
