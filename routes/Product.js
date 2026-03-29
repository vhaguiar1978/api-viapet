import express from "express";
import Products from "../models/Products.js";
import authenticate from "../middlewares/auth.js";
import owner from "../middlewares/owner.js";
import { Op } from "sequelize";

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
      unit,
    } = req.body;
    const usersId = req.user.id;

    // Validações
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ message: "Nome do produto é obrigatório" });
    }

    if (!price || isNaN(price) || price <= 0) {
      return res.status(400).json({ message: "Preço inválido" });
    }

    if (!stoke || !Number.isInteger(stoke) || stoke < 0) {
      return res.status(400).json({ message: "Estoque inválido" });
    }

    if (typeof unitary !== "boolean") {
      return res
        .status(400)
        .json({ message: "Campo unitário deve ser booleano" });
    }

    if (!category) {
      return res.status(400).json({ message: "Categoria é obrigatória" });
    }

    const product = await Products.create({
      usersId,
      name: name.trim(),
      description: description?.trim(),
      price,
      stoke,
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
    return res
      .status(500)
      .json({ message: "Erro ao adicionar produto", error: error.message });
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

    // Buscar o produto
    const product = await Products.findOne({
      where: {
        id: id,
        usersId: establishment,
      },
    });

    if (!product) {
      return res.status(404).json({ message: "Produto não encontrado" });
    }

    // Validações
    if (name && (typeof name !== "string" || name.trim().length === 0)) {
      return res.status(400).json({ message: "Nome do produto inválido" });
    }

    if (price && (isNaN(price) || price <= 0)) {
      return res.status(400).json({ message: "Preço inválido" });
    }

    if (stoke && (!Number.isInteger(stoke) || stoke < 0)) {
      return res.status(400).json({ message: "Estoque inválido" });
    }

    if (unitary !== undefined && typeof unitary !== "boolean") {
      return res
        .status(400)
        .json({ message: "Campo unitário deve ser booleano" });
    }

    // Atualizar o produto
    await product.update({
      name: name?.trim() || product.name,
      description: description?.trim() || product.description,
      price: price || product.price,
      stoke: stoke || product.stoke,
      unitary: unitary !== undefined ? unitary : product.unitary,
      category: category || product.category,
      observation: observation?.trim() || product.observation,
      imageUrl: imageUrl || product.imageUrl,
      cost: cost || product.cost,
      unit: unit || product.unit,
    });

    return res.status(200).json({
      message: "Produto atualizado com sucesso",
      product,
    });
  } catch (error) {
    console.error("Erro ao editar produto:", error);
    return res
      .status(500)
      .json({ message: "Erro ao editar produto", error: error.message });
  }
});

router.get("/product/barcode/:barcode", authenticate, async (req, res) => {
  try {
    const { barcode } = req.params;
    const establishment = req.user.establishment;

    if (!barcode) {
      return res.status(400).json({
        message: "Código de barras é obrigatório",
      });
    }

    const product = await Products.findOne({
      where: {
        barcode: barcode,
        usersId: establishment,
      },
    });

    if (!product) {
      return res.status(404).json({
        message: "Produto não encontrado",
      });
    }

    return res.status(200).json(product);
  } catch (error) {
    console.error("Erro ao buscar produto por código de barras:", error);
    return res.status(500).json({
      message: "Erro ao buscar produto",
      error: error.message,
    });
  }
});

router.get("/products/search", authenticate, async (req, res) => {
  // NOVA ROTA para busca de Produtos
  try {
    const { term } = req.query; // Recebe o termo de busca da query string
    const establishment = req.user.establishment;

    let whereClause = { usersId: establishment }; // Cláusula WHERE base para o estabelecimento

    if (term) {
      // Se um termo de busca for fornecido
      whereClause = {
        ...whereClause,
        name: { [Op.like]: `%${term}%` }, // Adiciona filtro por nome (case-insensitive)
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

    if (!products || products.length === 0) {
      return res.status(404).json({ message: "Nenhum produto encontrado" });
    }

    return res.status(200).json(products);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    return res
      .status(500)
      .json({ message: "Erro ao buscar produtos", error: error.message });
  }
});

router.post("/products/import", authenticate, async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
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

    // Função para processar o código de barras
    const parseBarcode = (barcode) => {
      if (!barcode) return "";
      return barcode.replace(/[\[\]]/g, "").trim();
    };

    // Processa os produtos
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
            stoke: parseInt(product.Estoque) || 0,
            unitary: true, // Define como padrão
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
        message: "Nenhum produto válido para importação",
      });
    }

    // Importa os produtos
    const results = await Promise.allSettled(
      processedProducts.map((product) =>
        Products.create(product).catch((error) => {
          console.error("Erro ao criar produto:", error);
          return null;
        }),
      ),
    );

    // Conta sucessos e falhas
    const imported = results.filter(
      (r) => r.status === "fulfilled" && r.value,
    ).length;
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
    const product = await Products.findByPk(id);

    if (!product) {
      return res.status(404).json({
        message: "Produto não encontrado",
      });
    }

    // Verify if user has permission to delete this product
    if (product.usersId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({
        message: "Você não tem permissão para deletar este produto",
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
