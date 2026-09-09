const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to fetch with custom User-Agent to avoid blocking
const letterboxdClient = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  }
});

// Helper to fetch all watchlist films for a user across pagination
async function fetchAllWatchlistFilms(username) {
  const watchlistUrl = `https://letterboxd.com/${username}/watchlist/`;
  let response;
  try {
    response = await letterboxdClient.get(watchlistUrl);
  } catch (err) {
    if (err.response && err.response.status === 404) {
      throw new Error(`Usuário '${username}' não encontrado ou watchlist privada.`);
    }
    throw new Error(`Falha ao buscar a watchlist de '${username}'.`);
  }

  // Check for Cloudflare challenge
  if (response.data && (response.data.includes('Just a moment') || response.data.includes('cf-browser-verification'))) {
    throw new Error('Letterboxd ativou a proteção anti-bot (Cloudflare). Tente novamente em alguns segundos.');
  }

  const $ = cheerio.load(response.data);

  const countText = $('.js-watchlist-count').text().trim();
  let totalFilms = 0;
  if (countText) {
    const match = countText.replace(/,/g, '').match(/(\d+)/);
    if (match) {
      totalFilms = parseInt(match[1], 10);
    }
  }

  const allFilms = new Map();

  const extractFilmsFromHtml = (html) => {
    const $p = cheerio.load(html);
    $p('.poster-list li.griditem, li.griditem').each((_, el) => {
      const comp = $p(el).find('.react-component[data-component-class="LazyPoster"]');
      const itemName = comp.attr('data-item-name');
      const itemSlug = comp.attr('data-item-slug');
      const itemLink = comp.attr('data-item-link');
      if (itemSlug && itemLink) {
        allFilms.set(itemSlug, { name: itemName || itemSlug, slug: itemSlug, link: itemLink });
      }
    });
  };

  extractFilmsFromHtml(response.data);

  const totalPages = totalFilms > 0 ? Math.ceil(totalFilms / 28) : Math.ceil(allFilms.size / 28);

  // Fetch pagination sequentially to avoid rate limiting / Cloudflare
  if (totalPages > 1) {
    for (let p = 2; p <= totalPages; p++) {
      try {
        const pageRes = await letterboxdClient.get(`https://letterboxd.com/${username}/watchlist/page/${p}/`);
        if (pageRes.data && !pageRes.data.includes('Just a moment')) {
          extractFilmsFromHtml(pageRes.data);
        }
      } catch (e) {
        // Ignore individual page errors
      }
    }
  }

  return Array.from(allFilms.values());
}

// Helper to enrich movie details from its film page
async function fetchFilmDetails(selectedFilm) {
  const filmUrl = `https://letterboxd.com${selectedFilm.link}`;
  let filmDetails = {
    title: selectedFilm.name,
    link: filmUrl,
    poster: null,
    description: null,
    director: null,
    genre: []
  };

  try {
    const filmResponse = await letterboxdClient.get(filmUrl);
    const $film = cheerio.load(filmResponse.data);

    const jsonLdScript = $film('script[type="application/ld+json"]').html();
    if (jsonLdScript) {
      const cleanJson = jsonLdScript.replace(/\/\*\s*<!\[CDATA\[\s*\*\/([\s\S]*?)\/\*\s*\]\]>\s*\*\//, '$1').trim();
      try {
        const ldData = JSON.parse(cleanJson);
        if (ldData.name) filmDetails.title = ldData.name;
        if (ldData.image) filmDetails.poster = ldData.image;
        if (ldData.description) filmDetails.description = ldData.description;
        if (ldData.director) {
          if (Array.isArray(ldData.director)) {
            filmDetails.director = ldData.director.map(d => d.name).join(', ');
          } else if (ldData.director.name) {
            filmDetails.director = ldData.director.name;
          }
        }
        if (ldData.genre) {
          filmDetails.genre = Array.isArray(ldData.genre) ? ldData.genre : [ldData.genre];
        }
      } catch (e) {}
    }

    if (!filmDetails.poster) {
      const ogImage = $film('meta[property="og:image"]').attr('content');
      if (ogImage) filmDetails.poster = ogImage;
    }
  } catch (err) {}

  return filmDetails;
}

app.get('/api/random-movie', async (req, res) => {
  try {
    let { username } = req.query;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    username = username.trim().toLowerCase();

    const films = await fetchAllWatchlistFilms(username);
    if (films.length === 0) {
      return res.status(404).json({ error: 'Nenhum filme encontrado nesta watchlist ou watchlist vazia.' });
    }

    const randomIndex = Math.floor(Math.random() * films.length);
    const selectedFilm = films[randomIndex];
    const filmDetails = await fetchFilmDetails(selectedFilm);

    return res.json({
      success: true,
      totalWatchlist: films.length,
      movie: filmDetails
    });

  } catch (error) {
    console.error('Error in /api/random-movie:', error.message);
    const status = error.message.includes('não encontrado') ? 404 : 500;
    return res.status(status).json({ error: error.message || 'Erro interno ao sortear filme.' });
  }
});

// Duo mode endpoint: common movies between user1 and user2
app.get('/api/common-movie', async (req, res) => {
  try {
    let { user1, user2 } = req.query;
    if (!user1 || !user2) {
      return res.status(400).json({ error: 'Ambos os usernames são obrigatórios.' });
    }
    user1 = user1.trim().toLowerCase();
    user2 = user2.trim().toLowerCase();

    if (user1 === user2) {
      return res.status(400).json({ error: 'Por favor, insira dois usernames diferentes.' });
    }

    // Fetch sequentially to prevent Cloudflare rate-limiting/blocking
    const films1 = await fetchAllWatchlistFilms(user1);
    const films2 = await fetchAllWatchlistFilms(user2);

    const user2Slugs = new Set(films2.map(f => f.slug));
    const commonFilms = films1.filter(f => user2Slugs.has(f.slug));

    if (commonFilms.length === 0) {
      return res.status(404).json({ error: `Nenhum filme em comum encontrado entre '${user1}' e '${user2}'.` });
    }

    const randomIndex = Math.floor(Math.random() * commonFilms.length);
    const selectedFilm = commonFilms[randomIndex];
    const filmDetails = await fetchFilmDetails(selectedFilm);

    return res.json({
      success: true,
      commonCount: commonFilms.length,
      movie: filmDetails
    });

  } catch (error) {
    console.error('Error in /api/common-movie:', error.message);
    const status = error.message.includes('não encontrado') ? 404 : 500;
    return res.status(status).json({ error: error.message || 'Erro interno ao buscar filmes em comum.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
