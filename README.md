# 🎬 Letterboxd Watchlist Randomizer

Cansado de rolar a sua watchlist do [Letterboxd](https://letterboxd.com) sem conseguir decidir o que assistir? Informe o seu nome de usuário e a aplicação sorteia um filme aleatório da sua lista, trazendo pôster, sinopse, diretor e gêneros.

## Como funciona

1. Você informa o seu username do Letterboxd na interface — o trecho que aparece na URL do seu perfil (`letterboxd.com/<username>/`), não necessariamente o nome de exibição do perfil.
2. O servidor faz scraping da página pública da sua watchlist (`letterboxd.com/<username>/watchlist`) para descobrir quantos filmes ela tem.
3. Um índice aleatório é sorteado e o filme correspondente é localizado, paginando o scraping quando necessário.
4. A página do filme sorteado é buscada para extrair pôster, sinopse, diretor e gêneros a partir dos dados `schema.org` (JSON-LD) da própria página.
5. O resultado é retornado para o front-end e exibido na tela.

> A sua watchlist precisa estar pública no Letterboxd para que o scraping funcione.

## Stack

- **Backend:** [Express](https://expressjs.com/) + [Axios](https://axios-http.com/) + [Cheerio](https://cheerio.js.org/) para scraping e parsing de HTML
- **Frontend:** HTML estático servido pelo Express, estilizado com [Tailwind CSS](https://tailwindcss.com/) (via CDN)
- **Deploy:** configurado para [Vercel](https://vercel.com/) (`vercel.json`)

## Rodando localmente

Pré-requisitos: [Node.js](https://nodejs.org/) 18+.

```bash
# clone o repositório
git clone git@github.com:JVMergulho/letterboxd-randomizer.git
cd letterboxd-randomizer

# instale as dependências
npm install

# suba o servidor
npm start
```

A aplicação sobe em `http://localhost:3000` por padrão. Para usar outra porta, defina a variável de ambiente `PORT`:

```bash
PORT=8080 npm start
```

## API

### `GET /api/random-movie?username=<letterboxd-username>`

Retorna um filme aleatório da watchlist pública do usuário informado.

**Resposta de sucesso:**

```json
{
  "success": true,
  "totalWatchlist": 128,
  "movie": {
    "title": "Parasita",
    "link": "https://letterboxd.com/film/parasite-2019/",
    "poster": "https://a.ltrbxd.com/resized/....jpg",
    "description": "...",
    "director": "Bong Joon-ho",
    "genre": ["Comedy", "Drama", "Thriller"]
  }
}
```

**Erros possíveis:**

| Status | Motivo |
|---|---|
| 400 | `username` não foi informado |
| 404 | Usuário não existe, watchlist privada ou vazia |
| 500 | Falha ao buscar dados do Letterboxd |

## Deploy

O projeto já inclui um `vercel.json` configurado para rodar o `server.js` como função serverless. Basta importar o repositório na [Vercel](https://vercel.com/) e o deploy é automático.

## Aviso

Este projeto depende de scraping de páginas públicas do Letterboxd, que não expõe uma API oficial para esse fim. Mudanças na estrutura HTML do site podem quebrar a extração de dados a qualquer momento.

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE) para mais detalhes.
