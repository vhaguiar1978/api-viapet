# GROQ_API_KEY global no Render — Modo Real para todos os usuários

Sem chave Groq, a IA cai no fallback de palavras-chave (modo simples).
Com uma chave global no Render, **todo usuário ganha IA real** sem precisar
configurar a própria chave no painel.

## Passo 1 — Criar a chave Groq

1. Entre em <https://console.groq.com/keys> (ou crie conta — gratuito).
2. Clique em **Create API Key**.
3. Dê um nome como `viapet-prod`.
4. Copie a chave que começa com `gsk_...`. **Anote agora — não dá pra ver de novo.**

### Limites do plano grátis (compartilhado entre todos os usuários ViaPet)

| Modelo | Tokens/min | Tokens/dia | Uso típico ViaPet |
|--------|------------|------------|-------------------|
| `llama-3.1-8b-instant` (fast, default) | 30k | 500k | ~10–15k mensagens/dia |
| `llama-3.3-70b-versatile` (smart, escalações) | 12k | 100k | ~1–3k mensagens/dia |

Híbrido implementado: 8B no normal, 70B só em casos sensíveis. Se passar do
limite, Groq retorna 429 e o sistema cai em keywords automaticamente (já tem
fallback em [crmAutoReply.js:1632](service/crmAutoReply.js)).

Se ultrapassar consistentemente, vale o plano pago do Groq (~$0.05/M tokens).

## Passo 2 — Cadastrar no Render

1. Entre em <https://dashboard.render.com>
2. Selecione o serviço **api.viapet.app** (ou nome equivalente do backend).
3. Menu lateral → **Environment**.
4. Clique em **Add Environment Variable**.
   - Key: `GROQ_API_KEY`
   - Value: `gsk_...` (a chave copiada)
5. **Save Changes**. O Render reinicia o serviço sozinho (~30s downtime).

## Passo 3 — Verificar

Depois do restart, num shell do servidor (Render → Shell) rode:

```bash
echo $GROQ_API_KEY | head -c 8
# deve imprimir: gsk_xxxx
```

Ou: abra qualquer conversa no CRM, mande uma mensagem de teste pelo "Chat de
teste da IA" no painel, e veja nos logs:

```
[CrmAutoReply] Groq respondeu: "..."
```

Se aparecer `Groq FALHOU (status=401...)` a chave está errada. Se aparecer
`Groq FALHOU (status=429...)` está rate-limitado (espera 1min ou troca de
plano).

## Passo 4 — Reverter (se precisar)

Basta apagar a env var `GROQ_API_KEY` no Render. O sistema volta pro fallback
de keywords sem erro. Usuários que tenham configurado a própria chave no
painel continuam funcionando com IA real (a chave do user ainda tem prioridade
sobre a env, ver [crmAutoReply.js:1578](service/crmAutoReply.js)).

## Bonus — Monitorar consumo

<https://console.groq.com/usage> mostra tokens/dia. Se >80% do limite por 3
dias seguidos, considere plano pago ou separar uma chave por grande cliente.
