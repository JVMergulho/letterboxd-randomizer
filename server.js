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

app.get('/api/random-movie', async (req, res) => {
  try {
    let { username } = req.query;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    username = username.trim().toLowerCase();

    // 1. Fetch page 1 of watchlist
    const watchlistUrl = `https://letterboxd.com/${username}/watchlist/`;
    let response;
    try {
      response = await letterboxdClient.get(watchlistUrl);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return res.status(404).json({ error: 'User not found or watchlist is private.' });
      }
      return res.status(500).json({ error: 'Failed to fetch Letterboxd watchlist.' });
    }

    const $ = cheerio.load(response.data);

    // 2. Extract total watchlist count
    const countText = $('.js-watchlist-count').text().trim();
    let totalFilms = 0;
    if (countText) {
      const match = countText.replace(/,/g, '').match(/(\d+)/);
      if (match) {
        totalFilms = parseInt(match[1], 10);
      }
    }

    // Fallback: count items on page 1 if count not found
    const gridItems = [];
    $('.poster-list li.griditem, li.griditem').each((_, el) => {
      const comp = $(el).find('.react-component[data-component-class="LazyPoster"]');
      const itemName = comp.attr('data-item-name');
      const itemSlug = comp.attr('data-item-slug');
      const itemLink = comp.attr('data-item-link');
      if (itemName && itemLink) {
        gridItems.push({ name: itemName, slug: itemSlug, link: itemLink });
      }
    });

    if (totalFilms === 0) {
      totalFilms = gridItems.length;
    }

    if (totalFilms === 0) {
      return res.status(404).json({ error: 'No films found in this watchlist or watchlist is empty.' });
    }

    // 3. Pick a random index
    const randomIndex = Math.floor(Math.random() * totalFilms);
    const page = Math.floor(randomIndex / 28) + 1;
    const localIndex = randomIndex % 28;

    let selectedFilm = null;

    if (page === 1) {
      selectedFilm = gridItems[randomIndex];
    } else {
      // Fetch specific page
      const pageUrl = `https://letterboxd.com/${username}/watchlist/page/${page}/`;
      try {
        const pageResponse = await letterboxdClient.get(pageUrl);
        const $page = cheerio.load(pageResponse.data);
        const pageItems = [];
        $page('.poster-list li.griditem, li.griditem').each((_, el) => {
          const comp = $page(el).find('.react-component[data-component-class="LazyPoster"]');
          const itemName = comp.attr('data-item-name');
          const itemSlug = comp.attr('data-item-slug');
          const itemLink = comp.attr('data-item-link');
          if (itemName && itemLink) {
            pageItems.push({ name: itemName, slug: itemSlug, link: itemLink });
          }
        });
        selectedFilm = pageItems[localIndex] || pageItems[0] || gridItems[0];
      } catch (err) {
        // Fallback to page 1 items if pagination fails
        selectedFilm = gridItems[randomIndex % gridItems.length];
      }
    }

    if (!selectedFilm) {
      return res.status(500).json({ error: 'Could not select a random film.' });
    }

    // 4. Fetch film details page for poster and metadata
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

      // Extract JSON-LD schema.org data
      const jsonLdScript = $film('script[type="application/ld+json"]').html();
      if (jsonLdScript) {
        // Clean up CDATA if present
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
        } catch (e) {
          // JSON parse error fallback
        }
      }

      // Fallback poster from OpenGraph meta if JSON-LD didn't have image
      if (!filmDetails.poster) {
        const ogImage = $film('meta[property="og:image"]').attr('content');
        if (ogImage) filmDetails.poster = ogImage;
      }
    } catch (err) {
      // If film page fetch fails, we still return the basic info from watchlist
    }

    return res.json({
      success: true,
      totalWatchlist: totalFilms,
      movie: filmDetails
    });

  } catch (error) {
    console.error('Error in /api/random-movie:', error.message);
    return res.status(500).json({ error: 'Internal server error while picking random movie.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
