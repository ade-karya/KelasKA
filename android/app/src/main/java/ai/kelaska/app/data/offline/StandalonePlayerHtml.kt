package ai.kelaska.app.data.offline

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import java.io.File
import java.util.Base64

/**
 * Menyusun dokumen HTML pemutar mandiri yang SAMA dengan yang dihasilkan
 * `lib/export/standalone-html/assemble.ts` di versi web. Aset pemutar
 * (`player.min.js` / `player.min.css`) adalah bundle yang persis dipakai
 * ekspor HTML web, jadi tampilan dan perilaku adegan (slide, kuis, narasi,
 * spotlight, laser, video, diskusi) identik dengan kelas di kelaska.riau.ai.
 *
 * Satu-satunya yang dilakukan di sini adalah menyiapkan manifest seperti
 * `prepareStandaloneManifest`: referensi media diganti `data:` URI, byte video
 * ditaruh di blok base64, dan aksi dipangkas ke field yang dibaca pemutar.
 * Tidak ada jaringan yang dipakai saat merakit maupun memutar.
 *
 * Narasi sengaja TIDAK lewat blok base64 + `URL.createObjectURL` seperti ekspor
 * web: WebView Android tidak memutar audio dari `blob:` URL (permintaan blob
 * ditolak saat `blockNetworkLoads` aktif), sehingga klip narasi menjadi senyap.
 * Semua media ber-MIME `audio/…` karena itu masuk media table sebagai `src`
 * berisi `data:` URI, yang diputar WebView tanpa menyentuh jaringan.
 */
object StandalonePlayerHtml {

    /** Isi file aset pemutar yang disalin dari build web. */
    data class PlayerAssets(
        val script: String,
        val style: String,
        val mathFonts: String,
        val chartsScript: String,
    )

    private const val CSP =
        "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; " +
            "style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; " +
            "font-src data:; frame-src data: blob:; worker-src data: blob:; " +
            "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

    private val REPLAYED_ACTIONS = setOf(
        "speech", "spotlight", "laser", "play_video", "discussion",
        "widget_highlight", "widget_setState", "widget_annotation", "widget_reveal",
    )

    private val SCRIPT_TAG = Regex("""(?is)<script\b[^>]*>.*?</script\s*>""")
    private val FORBIDDEN_TAG = Regex(
        """(?is)<(iframe|object|embed|form|link|meta|base)\b[^>]*>(?:.*?</\1\s*>)?""",
    )
    private val EVENT_ATTRIBUTE = Regex(
        """(?is)\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""",
    )
    private val URL_ATTRIBUTE = Regex(
        """(?is)\s(href|src|xlink:href|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""",
    )

    private fun JsonElement.text(): String? = (this as? JsonPrimitive)?.contentOrNull
    private fun JsonObject.text(key: String): String? = this[key]?.text()
    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
    private fun JsonObject.array(key: String): JsonArray? = this[key] as? JsonArray
    private fun JsonArray.objects(): List<JsonObject> = mapNotNull { it as? JsonObject }

    /** Manifest mentah dibaca ulang supaya field yang tidak dikenal model tetap ada. */
    private fun rawManifest(course: OfflineCourse): JsonObject {
        val file = File(course.rootDir, "manifest.json")
        if (!file.isFile) return JsonObject(emptyMap())
        return runCatching { Json.parseToJsonElement(file.readText()) as? JsonObject }
            .getOrNull() ?: JsonObject(emptyMap())
    }

    /** Susun dokumen lengkap. Dipanggil dari background thread. */
    fun build(course: OfflineCourse, assets: PlayerAssets): String {
        val builder = Builder(course, rawManifest(course))
        val manifest = builder.prepareManifest()
        val mediaTable = builder.mediaTable()
        val embeddedMedia = builder.embeddedMedia
        val needsMath = builder.needsMath
        val needsCharts = builder.needsCharts

        val styles = buildString {
            append("<style>").append(assets.style).append("</style>\n")
            if (needsMath) append("<style>").append(assets.mathFonts).append("</style>\n")
            // Penyesuaian khusus WebView aplikasi: jendela pemutar di ponsel
            // tidak selebar jendela browser, jadi bilah atas/bawah dipadatkan
            // di layar pendek (landscape) dan tombol navigasi menjadi ikon di
            // layar sempit (portrait) supaya tidak meluber.
            append("<style>").append(HOST_STYLE).append("</style>\n")
        }
        val extraScripts = if (needsCharts) {
            "<script>${assets.chartsScript}</script>\n"
        } else {
            ""
        }

        val strings = buildJsonObject { PLAYER_STRINGS.forEach { (key, value) -> put(key, JsonPrimitive(value)) } }
        val config = buildJsonObject {
            put("strings", strings)
            // Diskusi/PBL di offline hanya menautkan balik ke kelas online.
            put("classroomUrl", JsonPrimitive("https://kelaska.riau.ai"))
        }

        return buildString {
            append("<!doctype html>\n")
            append("<html lang=\"id\">\n<head>\n")
            append("<meta charset=\"utf-8\">\n")
            append("<meta http-equiv=\"Content-Security-Policy\" content=\"").append(CSP).append("\">\n")
            append("<meta name=\"referrer\" content=\"no-referrer\">\n")
            append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n")
            append("<meta name=\"generator\" content=\"Kelas Kecerdasan Artifisial\">\n")
            append("<title>").append(escapeHtml(course.manifest.stage.name.ifBlank { "Kelas" })).append("</title>\n")
            append(styles)
            append("<style>").append(FALLBACK_STYLE).append("</style>\n")
            append("</head>\n<body>\n")
            append("<div id=\"openmaic-player\"></div>\n")
            append(jsonBlock("openmaic-classroom", manifest))
            append(jsonBlock("openmaic-player-config", config))
            if (mediaTable.isNotEmpty()) {
                append(jsonBlock("openmaic-media", mediaTable))
                embeddedMedia.forEachIndexed { index, media ->
                    val id = "openmaic-media-${index + 1}"
                    append("<script type=\"application/octet-stream\" id=\"").append(id).append("\">")
                    append(media.base64)
                    append("</script>\n")
                }
            }
            append(extraScripts)
            append("<script>").append(assets.script).append("</script>\n")
            append("</body>\n</html>\n")
        }
    }

    private class Builder(
        private val course: OfflineCourse,
        private val raw: JsonObject,
    ) {
        /** key = path arsip (dipakai sebagai kunci media table), value = MIME. */
        private val media = LinkedHashMap<String, String>()
        private var math = false
        private var charts = false

        /** Byte media non-audio sudah di-base64 di sini supaya blok bisa ditulis verbatim. */
        val embeddedMedia: List<MediaWithBase64>
            get() = media.filterValues { !it.startsWith("audio/") }.map { (key, mime) ->
                val file = course.media(key) ?: File(course.rootDir, key)
                MediaWithBase64(
                    key = key,
                    mimeType = mime,
                    base64 = Base64.getEncoder().encodeToString(file.readBytes()),
                )
            }

        val needsMath: Boolean get() = math
        val needsCharts: Boolean get() = charts

        private fun mimeFor(file: File, ref: String?): String {
            val declared = course.manifest.mediaIndex.entries.firstOrNull { (path, entry) ->
                entry.sourceRef == ref || path == ref ||
                    path.substringAfterLast('/').substringBeforeLast('.') == ref?.substringAfterLast('/')?.substringBeforeLast('.')
            }?.value?.mimeType
            if (!declared.isNullOrBlank()) return declared
            return when (file.extension.lowercase()) {
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "gif" -> "image/gif"
                "svg" -> "image/svg+xml"
                "mp4", "m4v" -> "video/mp4"
                "webm" -> "video/webm"
                "mp3" -> "audio/mpeg"
                "wav" -> "audio/wav"
                "ogg", "opus" -> "audio/ogg"
                "m4a", "aac" -> "audio/mp4"
                "flac" -> "audio/flac"
                else -> "application/octet-stream"
            }
        }

        /** Daftarkan byte media dan kembalikan kunci media table-nya. */
        private fun register(ref: String?): String? {
            if (ref.isNullOrBlank()) return null
            val file = course.media(ref) ?: return null
            val key = runCatching { file.relativeTo(course.rootDir).path.replace(File.separatorChar, '/') }
                .getOrNull() ?: return null
            media.putIfAbsent(key, mimeFor(file, ref))
            return key
        }

        private fun dataUri(ref: String?): String? {
            if (ref.isNullOrBlank()) return null
            // Referensi sudah berupa data: URI (mis. gambar inline) dipertahankan.
            if (ref.startsWith("data:", ignoreCase = true)) return ref
            val file = course.media(ref) ?: return null
            val base64 = runCatching { Base64.getEncoder().encodeToString(file.readBytes()) }.getOrNull() ?: return null
            return "data:${mimeFor(file, ref)};base64,$base64"
        }

        fun prepareManifest(): JsonObject = buildJsonObject {
            raw.forEach { (key, value) ->
                when (key) {
                    "stage" -> put("stage", buildJsonObject {
                        (value as? JsonObject)?.forEach { (k, v) -> if (k != "videoManifest") put(k, v) }
                    })
                    "agents" -> put("agents", JsonArray(emptyList()))
                    "scenes" -> put("scenes", prepareScenes())
                    "mediaIndex" -> put("mediaIndex", JsonObject(emptyMap()))
                    else -> put(key, value)
                }
            }
            // rawManifest bisa kosong bila manifest.json tidak bisa dibaca;
            // tetaphasilkan bentuk minimal yang bisa diputar.
            if (!raw.containsKey("scenes")) {
                put("stage", buildJsonObject { put("name", JsonPrimitive(course.manifest.stage.name)) })
                put("agents", JsonArray(emptyList()))
                put("scenes", prepareScenes())
                put("mediaIndex", JsonObject(emptyMap()))
            }
        }

        private fun prepareScenes(): JsonArray {
            val rawScenes = raw.array("scenes")?.objects().orEmpty()
                .mapIndexed { index, scene -> index to scene }
                .sortedWith(compareBy<Pair<Int, JsonObject>>(
                    { it.second.text("order")?.toIntOrNull() ?: 0 },
                    { it.first },
                ))
                .map { it.second }

            // course.scenes adalah versi terurut yang sama; pakai itu bila raw
            // tidak tersedia.
            val scenes: List<JsonObject> = if (rawScenes.isNotEmpty()) rawScenes else emptyList()
            return buildJsonArray {
                scenes.forEach { scene -> add(prepareScene(scene)) }
            }
        }

        private fun prepareScene(scene: JsonObject): JsonObject = buildJsonObject {
            put("type", JsonPrimitive(scene.text("type") ?: "slide"))
            put("title", JsonPrimitive(scene.text("title") ?: ""))
            put("order", scene["order"] ?: JsonPrimitive(0))
            val content = scene.obj("content") ?: JsonObject(emptyMap())
            put("content", prepareContent(content))
            val actions = prepareActions(scene)
            if (actions.isNotEmpty()) put("actions", actions)
        }

        /**
         * Pemutar menyuntikkan rich text slide ke dokumennya sendiri lewat
         * dangerouslySetInnerHTML, sama seperti ekspor web. Ekspor web menjalankan
         * sanitizer persistensi sebelum menyusun HTML; lakukan penghapusan
         * minimal yang setara agar berkas .maic.zip yang tidak dipercaya tidak
         * bisa menyisipkan skrip atau memuat jaringan lewat atribut.
         */
        private fun sanitizeRichText(html: String): String {
            var s = SCRIPT_TAG.replace(html, "")
            s = FORBIDDEN_TAG.replace(s, "")
            s = EVENT_ATTRIBUTE.replace(s, "")
            s = URL_ATTRIBUTE.replace(s) { match ->
                val value = match.groupValues.getOrNull(2).orEmpty().trim('"', '\'')
                if (value.startsWith("javascript:", ignoreCase = true) ||
                    value.startsWith("data:text/html", ignoreCase = true)
                ) "" else match.value
            }
            return s
        }

        private fun sanitizeContent(value: JsonElement): JsonElement = when (value) {
            is JsonObject -> buildJsonObject { value.forEach { (k, v) -> put(k, sanitizeContent(v)) } }
            is JsonArray -> buildJsonArray { value.forEach { add(sanitizeContent(it)) } }
            is JsonPrimitive -> if (value.isString) JsonPrimitive(sanitizeRichText(value.content)) else value
            else -> value
        }

        private fun prepareContent(rawContent: JsonObject): JsonObject = buildJsonObject {
            val content = if (rawContent.text("type") == "interactive") {
                rawContent // HTML interaktif berjalan di iframeandbox, jangan diubah.
            } else {
                sanitizeContent(rawContent) as JsonObject
            }
            content.forEach { (key, value) ->
                when {
                    key == "canvas" && content.text("type") == "slide" ->
                        put("canvas", prepareCanvas(value as? JsonObject ?: JsonObject(emptyMap())))

                    key == "type" && content.text("type") == "interactive" -> put("type", value)
                    key == "url" && content.text("type") == "interactive" -> Unit
                    else -> put(key, value)
                }
            }
        }

        private fun prepareCanvas(canvas: JsonObject): JsonObject = buildJsonObject {
            canvas.forEach { (key, value) ->
                when (key) {
                    "elements" -> put("elements", buildJsonArray {
                        (value as? JsonArray)?.objects()?.forEach { add(prepareElement(it)) }
                    })
                    "background" -> put("background", prepareBackground(value as? JsonObject ?: JsonObject(emptyMap())))
                    else -> put(key, value)
                }
            }
        }

        private fun prepareBackground(background: JsonObject): JsonObject {
            if (background.text("type") != "image") return background
            val image = background.obj("image") ?: return background
            val resolved = dataUri(image.text("src")) ?: return background
            return buildJsonObject {
                background.forEach { (k, v) ->
                    if (k == "image") {
                        put("image", buildJsonObject {
                            image.forEach { (ik, iv) -> if (ik == "src") put("src", JsonPrimitive(resolved)) else put(ik, iv) }
                        })
                    } else {
                        put(k, v)
                    }
                }
            }
        }

        private fun prepareElement(element: JsonObject): JsonObject {
            when (element.text("type")) {
                "latex" -> math = true
                "chart" -> charts = true
            }
            val prepared = buildJsonObject {
                element.forEach { (key, value) ->
                    when {
                        key == "src" && element.text("type") == "image" -> {
                            val uri = dataUri(value.text())
                            put("src", uri?.let { JsonPrimitive(it) } ?: JsonPrimitive(""))
                        }
                        key == "pattern" && element.text("type") == "shape" -> {
                            val uri = dataUri(value.text())
                            if (uri != null) put("pattern", JsonPrimitive(uri))
                        }
                        key == "src" && element.text("type") == "video" -> put("src", JsonPrimitive(""))
                        key == "src" && element.text("type") == "audio" -> {
                            // Slide yang membawa klip audio sendiri: inline byte-nya
                            // supaya tombol putar di renderer benar-benar berbunyi.
                            val uri = dataUri(value.text())
                            put("src", uri?.let { JsonPrimitive(it) } ?: JsonPrimitive(""))
                        }
                        key == "mediaRef" && element.text("type") == "video" -> {
                            val ref = value.text() ?: element.text("src")
                            register(ref)?.let { put("mediaRef", JsonPrimitive(it)) }
                        }
                        key == "poster" && element.text("type") == "video" -> {
                            val uri = dataUri(value.text())
                            if (uri != null) put("poster", JsonPrimitive(uri))
                        }
                        key == "pointImages" && element.text("type") == "chart" ->
                            put(key, dataUriPointImages(value))
                        else -> put(key, value)
                    }
                }
            }
            // Arsip lama hanya punya `src` (tanpa `mediaRef`): tetap daftarkan
            // byte-nya supaya pemutar bisa memutar videonya, bukan poster saja.
            if (element.text("type") == "video" && prepared["mediaRef"] == null) {
                val key = register(element.text("mediaRef") ?: element.text("src"))
                if (key != null) {
                    return buildJsonObject {
                        prepared.forEach { (k, v) -> put(k, v) }
                        put("mediaRef", JsonPrimitive(key))
                    }
                }
            }
            return prepared
        }

        private fun dataUriPointImages(value: JsonElement): JsonElement {
            // importedStyle.series[].pointImages: peta point → ref gambar.
            if (value !is JsonObject) return value
            return buildJsonObject {
                value.forEach { (point, ref) ->
                    val uri = dataUri(ref.text())
                    if (uri != null) put(point, JsonPrimitive(uri))
                }
            }
        }

        private fun prepareActions(scene: JsonObject): JsonArray = buildJsonArray {
            (scene["actions"] as? JsonArray)?.objects()?.forEach { action ->
                val type = action.text("type") ?: return@forEach
                if (type !in REPLAYED_ACTIONS) return@forEach
                add(buildJsonObject {
                    put("id", action["id"] ?: JsonPrimitive(""))
                    put("type", JsonPrimitive(type))
                    when (type) {
                        "speech" -> {
                            put("text", JsonPrimitive(action.text("text") ?: ""))
                            val key = register(action.text("audioRef") ?: action.text("audioId"))
                            if (key != null) put("audioRef", JsonPrimitive(key))
                        }
                        "spotlight" -> {
                            put("elementId", JsonPrimitive(action.text("elementId") ?: ""))
                            action["dimOpacity"]?.let { put("dimOpacity", it) }
                        }
                        "laser" -> {
                            put("elementId", JsonPrimitive(action.text("elementId") ?: ""))
                            action["color"]?.let { put("color", it) }
                        }
                        "play_video" -> put("elementId", JsonPrimitive(action.text("elementId") ?: ""))
                        "discussion" -> put("topic", JsonPrimitive(action.text("topic") ?: ""))
                        "widget_highlight", "widget_annotation", "widget_reveal" -> {
                            action["target"]?.let { put("target", it) }
                            action["content"]?.let { put("content", it) }
                        }
                        "widget_setState" -> {
                            action["state"]?.let { put("state", it) }
                            action["content"]?.let { put("content", it) }
                        }
                    }
                })
            }
        }

        fun mediaTable(): JsonObject = buildJsonObject {
            var embeddedIndex = 0
            media.forEach { (key, mime) ->
                put(key, buildJsonObject {
                    put("mimeType", JsonPrimitive(mime))
                    if (mime.startsWith("audio/")) {
                        // `src` berisi data: URI: pemutar memakainya apa adanya,
                        // tanpa URL.createObjectURL yang tidak berfungsi di WebView.
                        put("src", JsonPrimitive(archiveDataUri(key, mime)))
                    } else {
                        embeddedIndex += 1
                        put("embedded", JsonPrimitive("openmaic-media-$embeddedIndex"))
                    }
                })
            }
        }

        private fun archiveDataUri(key: String, mime: String): String {
            val file = course.media(key) ?: File(course.rootDir, key)
            return "data:$mime;base64," + Base64.getEncoder().encodeToString(file.readBytes())
        }

    }

    private class MediaWithBase64(val key: String, val mimeType: String, val base64: String)

    private fun escapeHtml(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;")

    /** Escape sama seperti serializeJsonForHtmlScript di assemble.ts. */
    private fun jsonForScript(value: JsonElement): String =
        Json.encodeToString(JsonElement.serializer(), value)
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029")

    private fun jsonBlock(id: String, value: JsonElement): String =
        "<script type=\"application/json\" id=\"$id\">${jsonForScript(value)}</script>\n"

    /**
     * Penyesuaian tata letak untuk jendela WebView aplikasi. Bundle pemutar
     * memakai Tailwind dengan tinggi bilah tetap; di layar ponsel landscape
     * (tinggi < 520 dp) bilah itu memakan hampir separuh jendela, dan di
     * portrait sempit tombol "Sebelumnya"/"Berikutnya" berlabel teks membuat
     * footer meluber. Hanya menyentuh elemen di dalam `#openmaic-player`, jadi
     * dokumen ekspor web tetap sama.
     */
    private val HOST_STYLE = listOf(
        "@media (max-height:520px){",
        "#openmaic-player header{height:2.5rem}",
        "#openmaic-player footer{height:2.75rem}",
        "#openmaic-player .caption-bar{height:4.25rem}",
        "}",
        "@media (max-width:430px){",
        "#openmaic-player footer{gap:.375rem;padding-inline:.5rem}",
        "#openmaic-player footer button[data-testid=previous],",
        "#openmaic-player footer button[data-testid=next]{font-size:0;gap:0;padding-inline:.5rem}",
        "}",
    ).joinToString("")

    private val FALLBACK_STYLE = listOf(
        "#openmaic-player:empty{display:none}",
        ".openmaic-message{box-sizing:border-box;max-width:32rem;margin:2rem auto;padding:1rem 1.25rem;",
        "font:16px/1.5 system-ui,-apple-system,sans-serif;color:#334155;text-align:center}",
        ".openmaic-fallback{opacity:0;animation:openmaic-fallback-in 0s 2s forwards}",
        ".openmaic-fallback[data-failed]{opacity:1;animation:none}",
        "@keyframes openmaic-fallback-in{to{opacity:1}}",
    ).joinToString("")

    /** Sama persis dengan `export.htmlPlayer.*` di lib/i18n/locales/id-ID.json. */
    private val PLAYER_STRINGS = mapOf(
        "previous" to "Sebelumnya",
        "next" to "Berikutnya",
        "scenes" to "Adegan",
        "fullscreen" to "Layar penuh",
        "exitFullscreen" to "Keluar dari layar penuh",
        "emptyClassroom" to "Kelas ini tidak memiliki adegan.",
        "unsupportedScene" to "Adegan ini tidak tersedia dalam ekspor offline.",
        "interactiveTitle" to "Adegan interaktif",
        "interactiveMoreBelow" to "Selengkapnya di bawah",
        "videoUnavailable" to "Video tidak disertakan dalam ekspor offline",
        "quizSubmit" to "Kirim",
        "quizRetry" to "Coba lagi",
        "quizScore" to "Skor",
        "quizCorrect" to "Benar",
        "quizIncorrect" to "Salah",
        "quizCorrectAnswer" to "Jawaban benar",
        "quizExplanation" to "Pembahasan",
        "quizReferenceAnswer" to "Jawaban referensi",
        "quizNoReferenceAnswer" to "Soal ini belum memiliki jawaban referensi.",
        "quizAnswerPlaceholder" to "Ketik jawaban Anda…",
        "quizMultipleHint" to "Pilih semua yang sesuai",
        "pblScenario" to "Skenario",
        "pblGoal" to "Tujuan",
        "pblYourRole" to "Peran Anda",
        "pblCharacters" to "Tokoh",
        "pblLearningObjective" to "Tujuan pembelajaran",
        "pblMilestones" to "Tonggak",
        "pblOnlineOnly" to "Mengerjakan proyek bersama agen AI hanya tersedia di kelas online.",
        "pblContinueOnline" to "Lanjutkan proyek ini secara online",
        "play" to "Putar",
        "pause" to "Jeda",
        "playbackStart" to "Putar kelas",
        "playbackContinue" to "Lanjutkan",
        "captions" to "Subtitle",
        "discussionTitle" to "Diskusi",
        "discussionContinueOnline" to "Diskusikan ini di kelas online",
        "discussionDismiss" to "Tutup",
        "linkedFilesUnavailable" to "Beberapa gambar, narasi, atau video tidak dapat dimuat. Jika Anda membuka classroom.html dari dalam ZIP, ekstrak seluruh ZIP terlebih dahulu.",
        "scriptRequired" to "Kelas ini memerlukan JavaScript. Buka file ini di browser web dengan JavaScript aktif, seperti Safari atau Chrome.",
        "startFailed" to "Kelas ini tidak dapat dimulai. Coba buka file ini di browser lain, seperti Safari atau Chrome.",
    )
}
