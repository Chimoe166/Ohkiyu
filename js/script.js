/* ---------- Researchmapとの連携 ---------- */
(function () {
    "use strict";

    const widget = document.querySelector(".researchmap-widget[data-researchmap-id]");
    if (!widget) return;

    const RESEARCHMAP_ID = widget.dataset.researchmapId;
    const API_BASE_URL = "https://api.researchmap.jp/";
    const CACHE_MS = 60 * 60 * 1000;

    const presentationTypeLabels = {
        oral_presentation: "ORAL PRESENTATION",
        invited_oral_presentation: "INVITED TALK",
        invited: "INVITED TALK",
        keynote_speech: "KEYNOTE SPEECH",
        keynote: "KEYNOTE SPEECH",
        poster_presentation: "POSTER PRESENTATION",
        symposium_workshop_panel: "SYMPOSIUM / WORKSHOP",
        symposium: "SYMPOSIUM / WORKSHOP",
        public_lecture: "PUBLIC LECTURE",
        seminar: "SEMINAR",
        tutorial: "TUTORIAL",
        others: "PRESENTATION"
    };

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function safeUrl(value) {
        if (!value) return "";
        try {
            const url = new URL(value);
            return ["http:", "https:"].includes(url.protocol) ? url.href : "";
        } catch (error) {
            return "";
        }
    }

    function languageOrder() {
        return document.documentElement.lang === "ja" ? ["ja", "en"] : ["en", "ja"];
    }

    function pickLang(value) {
        if (!value) return "";
        if (typeof value === "string" || typeof value === "number") return String(value);

        for (const lang of languageOrder()) {
            if (typeof value[lang] === "string") return value[lang];
        }

        return Object.values(value).find((item) => typeof item === "string") || "";
    }

    function pickLangList(value) {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== "object") return [];

        for (const lang of languageOrder()) {
            if (Array.isArray(value[lang])) return value[lang];
        }

        return Object.values(value).find(Array.isArray) || [];
    }

    function getNames(value) {
        return pickLangList(value)
            .map((person) => pickLang(person.name || person.author_name || person.display_name || person))
            .filter(Boolean)
            .join(", ");
    }

    function getCache(key) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            return Date.now() - parsed.timestamp <= CACHE_MS ? parsed.data : null;
        } catch (error) {
            return null;
        }
    }

    function setCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (error) {
            // localStorageが利用できない環境でもAPI表示は継続する。
        }
    }

    async function fetchResearchmap(endpoint, retries = 2) {
        const cacheKey = `researchmap_${RESEARCHMAP_ID}_${endpoint}`;
        const cached = getCache(cacheKey);
        if (cached) return cached;

        const url = `${API_BASE_URL}${encodeURIComponent(RESEARCHMAP_ID)}/${endpoint}?limit=100`;

        for (let attempt = 0; ; attempt++) {
            try {
                const response = await fetch(url, { headers: { Accept: "application/json" } });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                setCache(cacheKey, data);
                return data;
            } catch (error) {
                if (attempt >= retries) throw error;
                // APIが一時的に500を返すことがあるため、少し待ってから再試行する。
                await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }
    }

    function firstIdentifier(item, key) {
        const value = item.identifiers?.[key] ?? item[key];
        return Array.isArray(value) ? value[0] || "" : value || "";
    }

    function getExternalLink(item) {
        const related = Array.isArray(item.see_also) ? item.see_also : [];
        const preferred = related.find((link) => link.label === "doi") ||
            related.find((link) => link.label === "url");
        return safeUrl(preferred?.["@id"] || item.url);
    }

    // presentation用のResearchmap詳細URLを生成
    function getPresentationLink(item) {
        // researchmap APIのpresentation ID
        const presentationId =
            item["rm:id"] ||
            item["@id"]?.split("/").pop();

        if (!presentationId) {
            return "";
        }

        return `https://researchmap.jp/${encodeURIComponent(RESEARCHMAP_ID)}/presentations/${presentationId}`;
    }

    function sortByDate(items, dateGetter) {
        return [...items].sort((a, b) => dateGetter(b).localeCompare(dateGetter(a)));
    }



    function renderPublications(data, containerId, limit = null) {
        const container = document.getElementById(containerId);

        // このページにその要素が無ければ何もしない
        if (!container) return;

        let items = sortByDate(data.items || [], item =>
            item.from_event_date || item.publication_date || item.to_event_date || ""
        );

        if (limit) {
            items = items.slice(0, limit);
        }

        container.innerHTML = items.map((item) => {
            const title = pickLang(item.paper_title || item.title || item.name) || "(No title)";
            const journal = pickLang(item.publication_name || item.journal_title || item.publisher);
            const authors = getNames(item.authors || item.paper_authors || item.creators);
            const date = item.publication_date || item.published_date || item.from_date || "";
            const year = date.slice(0, 4);
            const doi = firstIdentifier(item, "doi");
            const link = getExternalLink(item) || safeUrl(doi ? `https://doi.org/${doi}` : "");
            const titleHtml = link
                ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
                : escapeHtml(title);
            const actionLink = link
                ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>${doi ? "DOI" : "URL"}
                </a>`
                : "";

                return `
                <article class="pub-entry">
                <span class="year">${escapeHtml(year)}</span>
                <div>
                    ${journal ? `<span class="venue">${escapeHtml(journal)}</span>` : ""}
                    <h3>${titleHtml}</h3>
                    ${authors ? `<p class="authors">${escapeHtml(authors)}</p>` : ""}
                    ${(doi || actionLink) ? `
                        <div class="meta">
                            ${doi ? `<span>DOI: ${escapeHtml(doi)}</span>` : ""}
                            ${actionLink}
                        </div>
                    ` : ""}
                </div>
            </article>
            `;
             
        }).join("");
    }    


    function renderPresentations(data, containerId, limit = null) {
        const container = document.getElementById(containerId);

        // このページにその要素が無ければ何もしない
        if (!container) return;

        let items = sortByDate(data.items || [], item =>
            item.from_event_date || item.publication_date || item.to_event_date || ""
        );

        if (limit) {
            items = items.slice(0, limit);
        }

        container.innerHTML = items.map((item) => {
            const title = pickLang(item.presentation_title || item.title || item.name) || "(No title)";
            const event = pickLang(item.event || item.event_name || item.venue);
            const presenters = getNames(item.presenters || item.authors || item.creators);
            const date = item.from_event_date || item.publication_date || item.to_event_date || "";
            const displayDate = date.slice(0, 7).replace("-", ".");
            const type = presentationTypeLabels[item.presentation_type] ||
                String(item.presentation_type || "PRESENTATION").replaceAll("_", " ").toUpperCase();
            const link = getPresentationLink(item);
            const titleHtml = link
                ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
                : escapeHtml(title);

            console.log(item);
            return `<article class="pres-entry">
                <span class="date">${escapeHtml(displayDate)}</span>
                <div>
                    <span class="tag">[${escapeHtml(type)}]</span>
                    <h3>${titleHtml}</h3>
                    ${event ? `<p class="venue">${escapeHtml(event)}</p>` : ""}
                    ${presenters ? `<p class="presenters">${escapeHtml(presenters)}</p>` : ""}
                    ${link ? `<a href="${escapeHtml(link)}" class="link" target="_blank" rel="noopener noreferrer">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5"></path>
                            <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L12.5 19.5"></path>
                        </svg>Related link
                    </a>` : ""}
                </div>
            </article>`;
        }).join("");
        }

    function renderError(containerIds, label, error) {
        for (const containerId of containerIds) {
            const container = document.getElementById(containerId);
            if (!container) continue;
            container.innerHTML = `<p class="rm-status rm-error">${escapeHtml(label)} could not be loaded. Please view the records on Researchmap.</p>`;
        }
        console.error(`Researchmap ${label} error:`, error);
    }

    fetchResearchmap("presentations")
        .then(data => {
            //ここで3件取得の表示
            if (document.getElementById("rm-presentations")) {
                renderPresentations(data, "rm-presentations", 3);
            }
            //ここで全件取得
            if (document.getElementById("rm-all-presentations")) {
                renderPresentations(data, "rm-all-presentations");
            }
        })
        .catch(error => renderError(["rm-presentations", "rm-all-presentations"], "Presentations", error));

    fetchResearchmap("published_papers")
        .then(data => {
            //ここで3件取得の表示
            if (document.getElementById("rm-publications")) {
                renderPublications(data, "rm-publications", 3);
            }
            //ここで全件取得
            if (document.getElementById("rm-all-publications")) {
                renderPublications(data, "rm-all-publications");
            }
        })
        .catch(error => renderError(["rm-publications", "rm-all-publications"], "Publications", error));
})();


/* ---------- nav表示 ---------- */
// Active nav link on scroll (scroll spy)
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

function setActiveLink() {
    let currentSectionId = sections[0].id;

    sections.forEach(section => {
        const rect = section.getBoundingClientRect();
        // ナビの高さ分くらい上にオフセットして判定（sticky navに隠れないように）
        if (rect.top <= 120) {
            currentSectionId = section.id;
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${currentSectionId}`) {
            link.classList.add('active');
        }
    });
}

window.addEventListener('scroll', setActiveLink);
window.addEventListener('DOMContentLoaded', setActiveLink);
