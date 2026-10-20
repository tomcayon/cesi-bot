const https = require('https');
const { getCachedOrLogin } = require('../lib/cesiAuth');

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function getWeekBounds(offset = 0) {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { monday, sunday };
}

function toDateStr(date) {
    return date.toISOString().split('T')[0];
}

function toTimeStr(isoStr) {
    if (!isoStr) return '??:??';
    const m = isoStr.match(/T(\d{2}:\d{2})/);
    if (m) return m[1];
    return new Date(isoStr).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Paris'
    });
}

function fetchJSON(url, cookie) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'Cookie': cookie,
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://ent.cesi.fr/mon-emploi-du-temps'
            }
        }, (res) => {
            console.log(`[edt] HTTP ${res.statusCode} — ${url}`);
            if (res.statusCode >= 300 && res.statusCode < 400) {
                return reject(new Error(`Redirection (${res.statusCode}) — cookie invalide ou expiré`));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Erreur HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Réponse non-JSON de l\'API')); }
            });
        });
        req.on('error', reject);
    });
}

// Try multiple possible field name conventions
function pick(obj, ...paths) {
    for (const path of paths) {
        let val = obj;
        for (const key of path.split('.')) {
            if (val == null || typeof val !== 'object') { val = null; break; }
            val = val[key];
        }
        if (val != null && val !== '') return val;
    }
    return null;
}

function parseIntervenants(seance) {
    const arr = seance.intervenants || seance.formateurs || seance.enseignants || [];
    if (!Array.isArray(arr) || arr.length === 0) return 'N/A';
    return arr.map(i => {
        if (typeof i === 'string') return i;
        const prenom = i.prenom || '';
        const nom = i.nom || i.libelle || '';
        return `${prenom} ${nom}`.trim();
    }).filter(Boolean).join(', ');
}

// Un seul compte / une seule classe, configuré dans le .env :
// CESI_CODE_PERSONNE, CESI_EMAIL, CESI_PASSWORD (et CESI_COOKIE optionnel).
// L'API ENT du CESI n'autorise un compte qu'à consulter son propre emploi du temps,
// donc un identifiant ne couvre qu'une classe.
function loadClasse() {
    const env = process.env;
    if (!env.CESI_CODE_PERSONNE) return null;
    return {
        nom: env.CESI_NOM || 'Classe',
        codePersonne: env.CESI_CODE_PERSONNE,
        email: env.CESI_EMAIL,
        password: env.CESI_PASSWORD,
        cookie: env.CESI_COOKIE,
    };
}

const CLASSE = loadClasse();

module.exports = {
    name: 'edt',
    description: 'Affiche l\'emploi du temps CESI de la semaine',
    options: [
        {
            name: 'semaine',
            description: 'Décalage en semaines (0 = cette semaine, 1 = semaine prochaine…)',
            type: 4,
            required: false,
            min_value: 0,
            max_value: 8
        }
    ],
    async execute(interaction) {
        try {
            await interaction.deferReply();
        } catch (err) {
            console.error('[edt] deferReply échoué:', err);
            return;
        }

        const classe = CLASSE;
        if (!classe) { console.error('[edt] Aucune classe CESI configurée'); return interaction.deleteReply().catch(() => {}); }

        const { codePersonne, email, password } = classe;

        // Priorité : cookie manuel, sinon login automatique
        let cookie = classe.cookie || null;
        if (!cookie) {
            if (!email || !password) {
                console.error(`[edt] ${classe.nom} : ni cookie ni email/password configurés`);
                return interaction.deleteReply().catch(() => {});
            }
            try {
                cookie = await getCachedOrLogin(email, password);
            } catch (err) {
                console.error(`[edt] ${classe.nom} : login auto échoué:`, err);
                return interaction.deleteReply().catch(() => {});
            }
        }

        const offset = interaction.options.getInteger('semaine') ?? 0;
        const { monday, sunday } = getWeekBounds(offset);
        const url = `https://ent.cesi.fr/api/seance/all?start=${toDateStr(monday)}&end=${toDateStr(sunday)}&codePersonne=${codePersonne}&_=${Date.now()}`;

        let seances;
        try {
            seances = await fetchJSON(url, cookie);
        } catch (err) {
            console.error('[edt] fetchJSON échoué:', err.message);

            // Session expirée → reconnexion forcée si on a les identifiants
            if (err.message.includes('403') && email && password) {
                console.log('[edt] 403 détecté, tentative de reconnexion...');
                try {
                    cookie = await getCachedOrLogin(email, password, true);
                    seances = await fetchJSON(url, cookie);
                } catch (retryErr) {
                    console.error('[edt] Retry échoué:', retryErr.message);
                    return interaction.deleteReply().catch(() => {});
                }
            } else {
                return interaction.deleteReply().catch(() => {});
            }
        }

        if (!Array.isArray(seances) || seances.length === 0) {
            return interaction.deleteReply().catch(() => {});
        }

        // Group by calendar day
        const byDay = new Map();
        for (const seance of seances) {
            const debut = pick(seance, 'debut', 'dateDebut', 'start', 'startDate');
            if (!debut) continue;
            const dayKey = debut.slice(0, 10); // YYYY-MM-DD
            if (!byDay.has(dayKey)) byDay.set(dayKey, []);
            byDay.get(dayKey).push(seance);
        }

        // Sort days and sessions within each day
        const sortedDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

        const uniq = arr => [...new Set(arr.filter(Boolean))];
        const blocks = [];

        for (const [dayKey, daySeances] of sortedDays) {
            daySeances.sort((a, b) => {
                const aD = pick(a, 'debut', 'dateDebut') || '';
                const bD = pick(b, 'debut', 'dateDebut') || '';
                return aD.localeCompare(bD);
            });

            const date = new Date(dayKey + 'T12:00:00');
            const matin = [], apresMidi = [], intervenants = [], cours = [];

            for (const seance of daySeances) {
                const salleRaw = pick(seance, 'salle', 'salles', 'libelleSalle', 'room');
                const salle = Array.isArray(salleRaw)
                    ? salleRaw.map(s => s.nomSalle || s.libelle || s.nom || '?').join(', ')
                    : (salleRaw && typeof salleRaw === 'object')
                        ? (salleRaw.nomSalle || salleRaw.libelle || '?')
                        : (salleRaw || 'Salle inconnue');

                const heure = parseInt(toTimeStr(pick(seance, 'debut', 'dateDebut', 'start')), 10);
                (heure < 12 ? matin : apresMidi).push(salle);

                const inter = parseIntervenants(seance);
                if (inter !== 'N/A') intervenants.push(inter);
                cours.push(pick(seance, 'matiere.libelle', 'libelle', 'cours', 'title', 'nom') || 'Cours');
            }

            const salles = [];
            if (matin.length) salles.push(`${uniq(matin).join(', ')} (Matin)`);
            if (apresMidi.length) salles.push(`${uniq(apresMidi).join(', ')} (Après-midi)`);

            const inters = uniq(intervenants);
            const ligne = salles.join(' / ') + (inters.length ? ` - ${inters.join(', ')}` : '');

            blocks.push(`> ${JOURS[date.getDay()]}\n**${ligne}**\n${uniq(cours).join('\n')}`);
        }

        await interaction.editReply({ content: blocks.join('\n\n') });

        // if (['327094159708258304', '365124713623846913'].includes(interaction.user.id)) {
        //     interaction.followUp({ content: 'https://media4.giphy.com/media/v1.Y2lkPTZjMDliOTUyeG8zbnh3ZnRoNmRsd2VzbGJpczE2MnF2aTZvb2pvOHFxdWNkeHhxMSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Jq7cDVuZvieCO3sMHX/source.gif', ephemeral: true });
        //     console.log(`[edt] Easter egg activé pour ${interaction.user.tag}`);
        // }
    }
};
