const express = require('express');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/perform-login', async (req, res) => {
    let { url, username, password } = req.body;

    if (!url) {
        url = 'https://adfslight.edukacja.gorzow.pl/LoginPage.aspx?ReturnUrl=%2f%3fwa%3dwsignin1.0%26wtrealm%3dhttps%253a%252f%252faplikacje.edukacja.gorzow.pl%253a443%252f%26wctx%3drm%253d0%2526id%253dpassive%2526ru%253d%25252f%26wct%3d2025-11-22T15%253a01%253a45Z%26rt%3d0%26rs%3d1%26fr%3d1https://aplikacje.edukacja.gorzow.pl/';
    }

    let debugLogs = [];
    const log = (msg) => {
        console.log(msg);
        debugLogs.push(msg);
    };

    try {
        const pageResponse = await client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            }
        });

        let $ = cheerio.load(pageResponse.data);
        let form = $('form');
        let action = form.attr('action');

        let actionUrl = url;
        if (action) {
            const baseUrl = new URL(url).origin;
            actionUrl = new URL(action, baseUrl).toString();
        }

        const loginParams = new URLSearchParams();
        loginParams.append('Username', username);
        loginParams.append('Password', password);

        let response = await client.post(actionUrl, loginParams, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Referer': url
            },
            maxRedirects: 5
        });

        $ = cheerio.load(response.data);
        form = $('form');

        if (form.length > 0 && response.status === 200) {
            const nextAction = form.attr('action');
            let nextUrl = response.config.url;
            if (nextAction) {
                const baseUrl = new URL(response.config.url).origin;
                nextUrl = new URL(nextAction, baseUrl).toString();
            }

            const nextParams = new URLSearchParams();
            $('input').each((i, el) => {
                const name = $(el).attr('name');
                const value = $(el).attr('value');
                if (name) {
                    nextParams.append(name, value || '');
                }
            });

            response = await client.post(nextUrl, nextParams, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                    'Referer': response.config.url
                },
                maxRedirects: 5
            });
        }

        const success = !response.config.url.includes('LoginPage.aspx');

        res.json({
            status: success ? 'success' : 'failed',
            message: success ? 'Login successful' : 'Login failed',
            finalUrl: response.config.url,
            cookies: await jar.getCookies(url),
            debug: debugLogs
        });

    } catch (error) {
        res.status(500).json({ error: 'Login failed', details: error.message, debug: debugLogs });
    }
});

app.post('/navigate-service', async (req, res) => {
    const { serviceName } = req.body;
    const dashboardUrl = 'https://aplikacje.edukacja.gorzow.pl/';

    let debugLogs = [];
    const log = (msg) => { console.log(msg); debugLogs.push(msg); };

    try {
        const dashboardResponse = await client.get(dashboardUrl);
        const $ = cheerio.load(dashboardResponse.data);

        let targetLink = $('a').filter((i, el) => $(el).text().includes(serviceName)).attr('href');

        if (!targetLink) {
            throw new Error(`Service '${serviceName}' not found.`);
        }

        const baseUrl = new URL(dashboardUrl).origin;
        const targetUrl = new URL(targetLink, baseUrl).toString();

        let response = await client.get(targetUrl, {
            maxRedirects: 5
        });

        let loops = 0;
        while (loops < 5) {
            const $ = cheerio.load(response.data);
            const form = $('form');

            if (form.length > 0) {
                let nextAction = form.attr('action');
                let nextUrl = response.config.url;
                if (nextAction) {
                    try {
                        nextUrl = new URL(nextAction).toString();
                    } catch (e) {
                        const baseUrl = new URL(response.config.url).origin;
                        nextUrl = new URL(nextAction, baseUrl).toString();
                    }
                }

                const nextParams = new URLSearchParams();
                $('input').each((i, el) => {
                    const name = $(el).attr('name');
                    const value = $(el).attr('value');
                    if (name) {
                        nextParams.append(name, value || '');
                    }
                });

                response = await client.post(nextUrl, nextParams, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                        'Referer': response.config.url
                    },
                    maxRedirects: 5
                });
                loops++;
            } else {
                const jsRedirectMatch = response.data.match(/window\.location\.href\s*=\s*'([^']+)'\s*\+\s*"([^"]+)"/);

                if (jsRedirectMatch) {
                    const part1 = jsRedirectMatch[1];
                    const part2 = JSON.parse(`"${jsRedirectMatch[2]}"`);
                    let nextPath = part1 + part2;

                    let nextUrl;
                    try {
                        nextUrl = new URL(nextPath).toString();
                    } catch (e) {
                        const baseUrl = new URL(response.config.url).origin;
                        nextUrl = new URL(nextPath, baseUrl).toString();
                    }

                    response = await client.get(nextUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                            'Referer': response.config.url
                        },
                        maxRedirects: 5
                    });
                    loops++;
                } else {
                    break;
                }
            }
        }

        res.json({
            status: 'success',
            message: `Navigated to ${serviceName}`,
            finalUrl: response.config.url,
            debug: debugLogs,
            pageContent: response.data
        });

    } catch (error) {
        res.status(500).json({ error: 'Navigation failed', details: error.message, debug: debugLogs });
    }
});

app.get('/fetch-grades', async (req, res) => {
    const gradesUrl = 'https://synergia.librus.pl/przegladaj_oceny/uczen';

    try {
        const response = await client.get(gradesUrl);
        const $ = cheerio.load(response.data);

        const gradesData = [];

        $('table.decorated.stretch > tbody > tr').each((i, el) => {
            const row = $(el);
            if (row.attr('style')?.includes('display: none')) return;
            if (row.find('table').length > 0) return;

            const cells = row.find('td');
            if (cells.length < 3) return;

            const subject = $(cells[1]).text().trim();
            if (!subject) return;

            const grades = [];
            row.find('.grade-box a.ocena').each((j, gradeEl) => {
                grades.push($(gradeEl).text().trim());
            });

            if (subject && subject !== 'Zachowanie') {
                gradesData.push({ subject, grades });
            }
        });

        res.json({ status: 'success', grades: gradesData });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch grades', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
