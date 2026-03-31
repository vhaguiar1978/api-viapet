import express from "express";
import { Op } from "sequelize";
import Products from "../models/Products.js";
import authenticate from "../middlewares/auth.js";
import owner from "../middlewares/owner.js";

const router = express.Router();

router.post("/addProduct", authenticate, owner, async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      stoke,
      unitary,
      category,
      observation,
      barcode,
    } = req.body;
    const usersId = req.user.establishment;
    const normalizedPrice = price == null || price === "" ? 0 : Number(price);
    const normalizedStoke = stoke == null || stoke === "" ? 0 : Number(stoke);

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ message: "Nome do produto e obrigatorio" });
    }

    if (Number.isNaN(normalizedPrice) || normalizedPrice < 0) {
      return res.status(400).json({ message: "Preco invalido" });
    }

    if (!Number.isInteger(normalizedStoke) || normalizedStoke < 0) {
      return res.status(400).json({ message: "Estoque invalido" });
    }

    if (typeof unitary !== "boolean") {
      return res.status(400).json({ message: "Campo unitario deve ser booleano" });
    }

    if (!category) {
      return res.status(400).json({ message: "Categoria e obrigatoria" });
    }

    const product = await Products.create({
      usersId,
      name: name.trim(),
      description: description?.trim(),
      price: normalizedPrice,
      stoke: normalizedStoke,
      unitary,
      category,
      observation: observation?.trim(),
      barcode: barcode?.trim(),
    });

    return res.status(201).json({
      message: "Produto adicionado com sucesso",
      product,
    });
  } catch (error) {
    console.error("Erro ao adicionar produto:", error);
    return res.status(500).json({
      message: "Erro ao adicionar produto",
      error: error.message,
    });
  }
});

router.put("/editProduct", authenticate, owner, async (req, res) => {
  try {
    const {
      id,
      name,
      description,
      price,
      stoke,
      unitary,
      category,
      observation,
      imageUrl,
      cost,
      unit,
    } = req.body;
    const establishment = req.user.establishment;

    const product = await Products.findOne({
      where: {
        id,
        usersId: establishment,
      },
    });

    if (!product) {
      return res.status(404).json({ message: "Produto nao encontrado" });
    }

    if (name && (typeof name !== "string" || name.trim().length === 0)) {
      return res.status(400).json({ message: "Nome do produto invalido" });
    }

    if (price !== undefined && price !== null && price !== "" && (Number.isNaN(Number(price)) || Number(price) < 0)) {
      return res.status(400).json({ message: "Preco invalido" });
    }

    if (stoke !== undefined && stoke !== null && stoke !== "" && (!Number.isInteger(Number(stoke)) || Number(stoke) < 0)) {
      return res.status(400).json({ message: "Estoque invalido" });
    }

    if (unitary !== undefined && typeof unitary !== "boolean") {
      return res.status(400).json({ message: "Campo unitario deve ser booleano" });
    }

    await product.update({
      name: name?.trim() || product.name,
      description: description?.trim() || product.description,
      price: price !== undefined && price !== null && price !== "" ? Number(price) : product.price,
      stoke: stoke !== undefined && stoke !== null && stoke !== "" ? Number(stoke) : product.stoke,
      unitary: unitary !== undefined ? unitary : product.unitary,
      category: category || product.category,
      observation: observation?.trim() || product.observation,
      imageUrl: imageUrl || product.imageUrl,
      cost: cost ?? product.cost,
      unit: unit || product.unit,
    });

    return res.status(200).json({
      message: "Produto atualizado com sucesso",
      product,
    });
  } catch (error) {
    console.error("Erro ao editar produto:", error);
    return res.status(500).json({
      message: "Erro ao editar produto",
      error: error.message,
    });
  }
});

router.get("/product/barcode/:barcode", authenticate, async (req, res) => {
  try {
    const { barcode } = req.params;
    const establishment = req.user.establishment;

    if (!barcode) {
      return res.status(400).json({
        message: "Codigo de barras e obrigatorio",
      });
    }

    const product = await Products.findOne({
      where: {
        barcode,
        usersId: establishment,
      },
    });

    if (!product) {
      return res.status(404).json({
        message: "Produto nao encontrado",
      });
    }

    return res.status(200).json(product);
  } catch (error) {
    console.error("Erro ao buscar produto por codigo de barras:", error);
    return res.status(500).json({
      message: "Erro ao buscar produto",
      error: error.message,
    });
  }
});

router.get("/products/search", authenticate, async (req, res) => {
  try {
    const { term } = req.query;
    const establishment = req.user.establishment;

    let whereClause = { usersId: establishment };

    if (term) {
      whereClause = {
        ...whereClause,
        name: { [Op.like]: `%${term}%` },
      };
    }

    const products = await Products.findAll({
      where: whereClause,
      order: [["name", "ASC"]],
    });

    return res.status(200).json(products);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    return res.status(500).json({
      message: "Erro ao buscar produtos",
      error: error.message,
    });
  }
});

router.get("/products", authenticate, async (req, res) => {
  try {
    const establishment = req.user.establishment;

    const products = await Products.findAll({
      where: {
        usersId: establishment,
      },
      order: [["name", "ASC"]],
    });

    return res.status(200).json(products);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    return res.status(500).json({
      message: "Erro ao buscar produtos",
      error: error.message,
    });
  }
});

router.post("/products/import", authenticate, async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({
        success: false,
        message: "Dados invalidos para importacao",
      });
    }

    const parseMoneyValue = (value) => {
      if (!value) return 0;
      if (typeof value === "number") return value;
      return Number(value.toString().replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;
    };

    const parseBarcode = (barcode) => {
      if (!barcode) return "";
      return barcode.replace(/[\[\]]/g, "").trim();
    };

    const processedProducts = products
      .map((product) => {
        try {
          return {
            usersId: req.user.establishment,
            name: product.Produto || "",
            category: product.Tipo || "",
            unit: product.Unidade || "unidade",
            barcode: parseBarcode(product.Codigo_Barras),
            cost: parseMoneyValue(product.Custo),
            price: parseMoneyValue(product.Valor),
            stoke: parseInt(product.Estoque, 10) || 0,
            unitary: true,
            description: "",
            observation: "",
          };
        } catch (error) {
          console.error("Erro ao processar produto:", error);
          return null;
        }
      })
      .filter((product) => product !== null && product.name);

    if (processedProducts.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nenhum produto valido para importacao",
      });
    }

    const results = await Promise.allSettled(
      processedProducts.map((product) =>
        Products.create(product).catch((error) => {
          console.error("Erro ao criar produto:", error);
          return null;
        }),
      ),
    );

    const imported = results.filter((result) => result.status === "fulfilled" && result.value).length;
    const failed = processedProducts.length - imported;

    return res.status(200).json({
      success: true,
      message: `${imported} produtos importados com sucesso${failed > 0 ? `. ${failed} falharam.` : ""}`,
      importedCount: imported,
      failedCount: failed,
    });
  } catch (error) {
    console.error("Erro ao importar produtos:", error);
    return res.status(500).json({
      success: false,
      message: "Erro ao importar produtos",
      error: error.message,
    });
  }
});

router.delete("/deleteproduct", authenticate, owner, async (req, res) => {
  const { id } = req.body;

  try {
    const product = await Products.findOne({
      where: {
        id,
        usersId: req.user.establishment,
      },
    });

    if (!product) {
      return res.status(404).json({
        message: "Produto nao encontrado",
      });
    }

    if (product.usersId !== req.user.establishment && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Voce nao tem permissao para deletar este produto",
      });
    }

    await product.destroy();

    return res.status(200).json({
      message: "Produto deletado com sucesso",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Erro ao deletar produto",
      error: error.message,
    });
  }
});

export default router;
