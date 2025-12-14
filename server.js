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

        const gradeValues = {
            '6': 6, '6-': 5.75,
            '5+': 5.5, '5': 5, '5-': 4.75,
            '4+': 4.5, '4': 4, '4-': 3.75,
            '3+': 3.5, '3': 3, '3-': 2.75,
            '2+': 2.5, '2': 2, '2-': 1.75,
            '1+': 1.5, '1': 1, '1-': 0.75,
            '0': 0
        };

        $('table.decorated.stretch > tbody > tr').each((i, el) => {
            const row = $(el);
            if (row.attr('style')?.includes('display: none')) return;
            if (row.find('table').length > 0) return;

            const cells = row.find('td');
            if (cells.length < 3) return;

            const subject = $(cells[1]).text().trim();
            if (!subject) return;

            const grades = [];
            let sumWeighted = 0;
            let sumWeights = 0;

            row.find('.grade-box a.ocena').each((j, gradeEl) => {
                const el = $(gradeEl);
                const text = el.text().trim();
                const title = el.attr('title') || '';

                // Extract weight from title, e.g., "Waga: 2"
                let weight = 1;
                const weightMatch = title.match(/Waga: ?(\d+)/);
                if (weightMatch) {
                    weight = parseInt(weightMatch[1]);
                }

                // Determine numerical value
                let value = null;
                if (gradeValues.hasOwnProperty(text)) {
                    value = gradeValues[text];
                } else {
                    // Try to parse simple number if not in map
                    const parsed = parseFloat(text);
                    if (!isNaN(parsed)) value = parsed;
                }

                if (value !== null) {
                    // Ignore weights of 0 (often used for information only)
                    if (weight > 0) {
                        sumWeighted += value * weight;
                        sumWeights += weight;
                    }
                }

                grades.push({
                    grade: text,
                    weight: weight,
                    value: value,
                    desc: title // Optional: keep full description for debug
                });
            });

            const average = sumWeights > 0 ? (sumWeighted / sumWeights).toFixed(2) : '-';

            if (subject && subject !== 'Zachowanie') {
                gradesData.push({ subject, grades, average });
            }
        });

        res.json({ status: 'success', grades: gradesData });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch grades', details: error.message });
    }
});

app.get('/fetch-attendance', async (req, res) => {
    const attendanceUrl = 'https://synergia.librus.pl/przegladaj_nb/uczen';

    try {
        const response = await client.get(attendanceUrl);
        const $ = cheerio.load(response.data);

        const attendanceData = [];

        $('table.decorated.center.big tr').each((i, el) => {
            const row = $(el);

            if (row.find('th').length > 0) return;
            if (row.hasClass('line1') && row.find('td').length === 1) return;

            const cells = row.find('td');
            if (cells.length < 2) return;

            const dateText = $(cells[0]).text().trim();
            if (!dateText || dateText === 'Data' || dateText === '' || dateText.includes('Suma') || dateText.includes('Okres')) return;

            const lessonBoxes = $(cells[1]).find('p.box');
            const absences = [];

            lessonBoxes.each((idx, box) => {
                const link = $(box).find('a');
                if (link.length > 0) {
                    const type = link.text().trim();
                    const title = link.attr('title') || '';

                    const lessonMatch = title.match(/Lekcja: ([^\n<]+)/);
                    const typeMatch = title.match(/Rodzaj: ([^\n<]+)/);
                    const hourMatch = title.match(/Godzina lekcyjna: (\d+)/);

                    absences.push({
                        lessonNumber: hourMatch ? parseInt(hourMatch[1]) : idx + 1,
                        type: typeMatch ? typeMatch[1] : type,
                        lesson: lessonMatch ? lessonMatch[1] : 'Unknown'
                    });
                }
            });

            if (absences.length > 0) {
                attendanceData.push({
                    date: dateText,
                    absences: absences
                });
            }
        });

        res.json({ status: 'success', attendance: attendanceData });

    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch attendance', details: error.message });
    }
});

app.get('/calculate-attendance-percentage', async (req, res) => {
    try {
        const realizedLessons = {};
        const absences = {};

        let page = 0;
        let hasMorePages = true;

        while (hasMorePages) {
            const url = 'https://synergia.librus.pl/zrealizowane_lekcje';

            const formData = new URLSearchParams();
            formData.append('data1', '2025-09-01');
            formData.append('data2', '2025-11-29');
            formData.append('filtruj_id_przedmiotu', '-1');
            formData.append('filtruj_realizacje', 'Filtruj');
            formData.append('numer_strony1001', page.toString());
            formData.append('porcjowanie_pojemnik1001', '1001');

            const response = await client.post(url, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const $ = cheerio.load(response.data);

            $('table.decorated tbody tr').each((i, el) => {
                const row = $(el);
                const cells = row.find('td');

                if (cells.length < 4) return;

                const subjectCell = $(cells[3]);
                const subjectText = subjectCell.find('b').text().trim();

                if (!subjectText) return;

                if (!realizedLessons[subjectText]) {
                    realizedLessons[subjectText] = 0;
                }
                realizedLessons[subjectText]++;
            });

            const nextPageLink = $('.pagination li a').filter((i, el) => {
                return $(el).text().includes('Następna');
            });

            if (nextPageLink.length === 0) {
                hasMorePages = false;
            } else {
                page++;
                if (page > 30) hasMorePages = false;
            }
        }

        const absenceResponse = await client.get('https://synergia.librus.pl/przegladaj_nb/uczen');
        const $abs = cheerio.load(absenceResponse.data);

        $abs('table.decorated.center.big tr').each((i, el) => {
            const row = $abs(el);

            if (row.find('th').length > 0) return;
            if (row.hasClass('line1') && row.find('td').length === 1) return;

            const cells = row.find('td');
            if (cells.length < 2) return;

            const dateText = $abs(cells[0]).text().trim();
            if (!dateText || dateText === 'Data' || dateText === '' || dateText.includes('Suma') || dateText.includes('Okres')) return;

            const lessonBoxes = $abs(cells[1]).find('p.box');

            lessonBoxes.each((idx, box) => {
                const link = $abs(box).find('a');
                if (link.length > 0) {
                    const title = link.attr('title') || '';
                    const lessonMatch = title.match(/Lekcja: ([^\n<]+)/);
                    const typeMatch = title.match(/Rodzaj: ([^\n<]+)/);

                    if (lessonMatch && typeMatch && (typeMatch[1] === 'nieobecność' || typeMatch[1] === 'nieobecność uspr.')) {
                        const subject = lessonMatch[1];
                        if (!absences[subject]) {
                            absences[subject] = 0;
                        }
                        absences[subject]++;
                    }
                }
            });
        });

        const attendanceStats = [];

        for (const subject in realizedLessons) {
            const total = realizedLessons[subject];
            const absent = absences[subject] || 0;
            const present = total - absent;
            const percentage = total > 0 ? ((present / total) * 100).toFixed(2) : 0;

            // Calculate how many MORE lessons can be missed to reach exactly 50%
            // Formula derived from: present / (total + x) = 0.5  =>  2 * present = total + x  =>  x = 2 * present - total
            const absencesUntil50 = (2 * present) - total;

            attendanceStats.push({
                subject: subject,
                totalLessons: total,
                absences: absent,
                present: present,
                attendancePercentage: parseFloat(percentage),
                absencesUntil50Percent: absencesUntil50
            });
        }

        attendanceStats.sort((a, b) => a.attendancePercentage - b.attendancePercentage);

        res.json({
            status: 'success',
            stats: attendanceStats,
            summary: {
                totalSubjects: attendanceStats.length,
                averageAttendance: (attendanceStats.reduce((sum, s) => sum + s.attendancePercentage, 0) / attendanceStats.length).toFixed(2)
            }
        });

    } catch (error) {
        res.status(500).json({ error: 'Failed to calculate attendance', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
