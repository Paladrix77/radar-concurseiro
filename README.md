# Radar do Concurseiro

Site para concurseiros: lista os concursos das bancas, vigia nomes e termos no Diário Oficial da União e avisa no Telegram quando sai edital, retificação ou resultado novo.

Feito com Cloudflare Workers + D1, em um arquivo só (`worker.js`).

## Como publicar
1. Crie um bot no Telegram com o @BotFather e guarde o token.
2. Crie o banco: `wrangler d1 create radar-concurseiro` e rode `wrangler d1 execute radar-concurseiro --remote --file schema.sql`.
3. Ajuste o `wrangler.toml` (id do banco e `BOT_USERNAME`).
4. `wrangler secret put TELEGRAM_TOKEN` e `wrangler secret put ADMIN_KEY`.
5. `wrangler deploy`.
6. Abra `/admin/telegram?key=SUA_SENHA` uma vez e depois `/admin/rodar?key=SUA_SENHA&dou` para testar.

## Fontes
As bancas ficam na lista `FONTES` no começo do `worker.js`. A aba Novidades mostra quantos concursos cada fonte achou na última rodada.
