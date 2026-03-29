import express from "express";
import Users from "../../models/Users.js";
import authenticate from "../../middlewares/auth.js";
import owner from "../../middlewares/owner.js";

const router = express.Router();

router.put("/editFunc", authenticate, owner, async (req, res) => {
  try {
    const { name, status, id } = req.body;
    const establishment = req.user.establishment;

    if (!id) {
      return res
        .status(400)
        .json({ message: "ID do funcionário não informado" });
    }

    const funcionario = await Users.findOne({
      where: {
        id,
        establishment,
        role: "funcionario",
      },
    });

    if (!funcionario) {
      return res.status(404).json({ message: "Funcionário não encontrado" });
    }

    if (name) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ message: "Nome inválido" });
      }
      funcionario.name = name.trim();
    }

    if (status !== undefined) {
      if (typeof status !== "boolean") {
        return res.status(400).json({ message: "Status deve ser um booleano" });
      }
      funcionario.status = status;
    }

    await funcionario.save();
    return res
      .status(200)
      .json({ message: "Funcionário atualizado com sucesso" });
  } catch (error) {
    console.error("Erro ao atualizar funcionário:", error);
    return res
      .status(500)
      .json({ message: "Erro ao atualizar funcionário", error: error.message });
  }
});

router.delete("/deleteFunc/:id", authenticate, owner, async (req, res) => {
  try {
    const { id } = req.params;
    const establishment = req.user.establishment;

    if (!id) {
      return res
        .status(400)
        .json({ message: "ID do funcionário não informado" });
    }

    const funcionario = await Users.findOne({
      where: {
        id,
        establishment,
        role: "funcionario",
      },
    });

    if (!funcionario) {
      return res.status(404).json({ message: "Funcionário não encontrado" });
    }

    await funcionario.destroy();
    return res
      .status(200)
      .json({ message: "Funcionário excluído com sucesso" });
  } catch (error) {
    console.error("Erro ao excluir funcionário:", error);
    return res
      .status(500)
      .json({ message: "Erro ao excluir funcionário", error: error.message });
  }
});

export default router;
