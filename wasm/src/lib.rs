//! Inkwell core: Markdown → HTML engine compiled to WebAssembly.
//!
//! Exposes a tiny C ABI (no wasm-bindgen) so the extension can load the
//! module with nothing but `WebAssembly.instantiateStreaming`.

use pulldown_cmark::{CowStr, Event, Options, Parser, Tag, TagEnd};
use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt::Write as _;
use unicode_width::UnicodeWidthStr;

mod emoji;

pub const FLAG_SMART_PUNCT: u32 = 1;
pub const FLAG_HARD_BREAKS: u32 = 2;
pub const FLAG_SUBSCRIPT: u32 = 4;

thread_local! {
    static HTML_OUT: RefCell<String> = const { RefCell::new(String::new()) };
    static META_OUT: RefCell<String> = const { RefCell::new(String::new()) };
}

// ---------------------------------------------------------------------------
// C ABI
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` must come from `alloc(len)`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

unsafe fn input<'a>(ptr: *const u8, len: usize) -> &'a str {
    std::str::from_utf8_unchecked(std::slice::from_raw_parts(ptr, len))
}

/// Render markdown. Results are read back with `html_ptr/len` and `meta_ptr/len`.
///
/// # Safety
/// `ptr..ptr+len` must be valid UTF-8 in linear memory.
#[no_mangle]
pub unsafe extern "C" fn render(ptr: *const u8, len: usize, flags: u32) {
    let (html, meta) = render_markdown(input(ptr, len), flags);
    HTML_OUT.with(|o| *o.borrow_mut() = html);
    META_OUT.with(|o| *o.borrow_mut() = meta);
}

/// Re-align every pipe table in the document. Result is read from `html_ptr/len`.
///
/// # Safety
/// `ptr..ptr+len` must be valid UTF-8 in linear memory.
#[no_mangle]
pub unsafe extern "C" fn format_tables(ptr: *const u8, len: usize) {
    let out = format_tables_str(input(ptr, len));
    HTML_OUT.with(|o| *o.borrow_mut() = out);
}

/// Write the emoji shortcode table as JSON (`[["name","😀"],...]`) to the html buffer.
#[no_mangle]
pub extern "C" fn emoji_list() {
    let mut out = String::from("[");
    for (i, (name, e)) in emoji::all().iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('[');
        json_str(&mut out, name);
        out.push(',');
        json_str(&mut out, e);
        out.push(']');
    }
    out.push(']');
    HTML_OUT.with(|o| *o.borrow_mut() = out);
}

#[no_mangle]
pub extern "C" fn html_ptr() -> *const u8 {
    HTML_OUT.with(|o| o.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn html_len() -> usize {
    HTML_OUT.with(|o| o.borrow().len())
}
#[no_mangle]
pub extern "C" fn meta_ptr() -> *const u8 {
    META_OUT.with(|o| o.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn meta_len() -> usize {
    META_OUT.with(|o| o.borrow().len())
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

fn options(flags: u32) -> Options {
    let mut o = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES
        | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        | Options::ENABLE_MATH
        | Options::ENABLE_GFM
        | Options::ENABLE_DEFINITION_LIST
        | Options::ENABLE_SUPERSCRIPT
        | Options::ENABLE_WIKILINKS;
    if flags & FLAG_SMART_PUNCT != 0 {
        o |= Options::ENABLE_SMART_PUNCTUATION;
    }
    if flags & FLAG_SUBSCRIPT != 0 {
        o |= Options::ENABLE_SUBSCRIPT;
    }
    o
}

struct OutlineItem {
    level: u8,
    text: String,
    id: String,
    line: usize,
}

struct PendingHeading {
    event_index: usize,
    text: String,
    line: usize,
}

pub fn render_markdown(src: &str, flags: u32) -> (String, String) {
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(src.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    let line_of = |offset: usize| match line_starts.binary_search(&offset) {
        Ok(i) => i,
        Err(i) => i - 1,
    };

    let mut events: Vec<Event> = Vec::new();
    let mut depth = 0usize;
    let mut in_code = false;
    let mut in_meta = false;
    let mut link_depth = 0usize;
    let mut pending_text = String::new();
    let mut heading: Option<PendingHeading> = None;
    let mut slugs: HashMap<String, usize> = HashMap::new();
    let mut outline: Vec<OutlineItem> = Vec::new();
    let mut plain = String::new();
    let mut frontmatter = String::new();
    let (mut tasks, mut tasks_done) = (0usize, 0usize);
    let (mut links, mut images, mut code_blocks, mut tables, mut math) = (0, 0, 0, 0, 0);

    for (ev, range) in Parser::new_ext(src, options(flags)).into_offset_iter() {
        if !matches!(ev, Event::Text(_)) || in_code || in_meta || link_depth > 0 {
            flush_text(&mut pending_text, &mut events, flags);
        }
        match ev {
            Event::Start(tag) => {
                if depth == 0 && !matches!(tag, Tag::MetadataBlock(_)) {
                    // Invisible anchor used by the UI for scroll sync.
                    events.push(Event::Html(
                        format!("<span class=\"src-line\" data-line=\"{}\"></span>", line_of(range.start)).into(),
                    ));
                }
                depth += 1;
                match &tag {
                    Tag::CodeBlock(_) => {
                        in_code = true;
                        code_blocks += 1;
                    }
                    Tag::Link { .. } => {
                        link_depth += 1;
                        links += 1;
                    }
                    Tag::Image { .. } => {
                        link_depth += 1;
                        images += 1;
                    }
                    Tag::Table(_) => tables += 1,
                    Tag::MetadataBlock(_) => in_meta = true,
                    Tag::Heading { .. } => {
                        heading = Some(PendingHeading {
                            event_index: events.len(),
                            text: String::new(),
                            line: line_of(range.start),
                        })
                    }
                    _ => {}
                }
                events.push(Event::Start(tag));
            }
            Event::End(end) => {
                depth = depth.saturating_sub(1);
                match end {
                    TagEnd::CodeBlock => in_code = false,
                    TagEnd::Link | TagEnd::Image => link_depth = link_depth.saturating_sub(1),
                    TagEnd::MetadataBlock(_) => in_meta = false,
                    TagEnd::Heading(_) => {
                        if let Some(h) = heading.take() {
                            finish_heading(h, &mut events, &mut slugs, &mut outline);
                        }
                    }
                    _ => {}
                }
                if matches!(
                    end,
                    TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::Item | TagEnd::CodeBlock | TagEnd::TableCell
                ) {
                    plain.push('\n');
                }
                events.push(Event::End(end));
            }
            Event::Text(t) => {
                if in_meta {
                    frontmatter.push_str(&t);
                    events.push(Event::Text(t));
                    continue;
                }
                if let Some(h) = heading.as_mut() {
                    h.text.push_str(&t);
                }
                plain.push_str(&t);
                if in_code || link_depth > 0 {
                    events.push(Event::Text(t));
                } else {
                    pending_text.push_str(&t);
                }
            }
            Event::Code(t) => {
                if let Some(h) = heading.as_mut() {
                    h.text.push_str(&t);
                }
                plain.push_str(&t);
                events.push(Event::Code(t));
            }
            Event::InlineMath(t) | Event::DisplayMath(t) if t.is_empty() => {
                events.push(Event::Text(t));
            }
            Event::InlineMath(t) => {
                math += 1;
                plain.push_str(&t);
                events.push(Event::InlineMath(t));
            }
            Event::DisplayMath(t) => {
                math += 1;
                plain.push_str(&t);
                events.push(Event::DisplayMath(t));
            }
            Event::SoftBreak => {
                plain.push(' ');
                events.push(if flags & FLAG_HARD_BREAKS != 0 { Event::HardBreak } else { Event::SoftBreak });
            }
            Event::HardBreak => {
                plain.push(' ');
                events.push(Event::HardBreak);
            }
            Event::TaskListMarker(checked) => {
                tasks += 1;
                if checked {
                    tasks_done += 1;
                }
                // Clickable checkbox that knows where its `[ ]` lives in the source.
                events.push(Event::InlineHtml(
                    format!(
                        "<input type=\"checkbox\" class=\"task-box\" data-offset=\"{}\"{}>",
                        range.start,
                        if checked { " checked" } else { "" }
                    )
                    .into(),
                ));
            }
            other => events.push(other),
        }
    }
    flush_text(&mut pending_text, &mut events, flags);

    let mut html = String::with_capacity(src.len() * 3 / 2);
    pulldown_cmark::html::push_html(&mut html, events.into_iter());

    let words = plain.split_whitespace().filter(|w| w.chars().any(|c| c.is_alphanumeric())).count();
    let chars = src.chars().count();
    let chars_no_space = src.chars().filter(|c| !c.is_whitespace()).count();

    let mut meta = String::with_capacity(256 + outline.len() * 64);
    meta.push_str("{\"outline\":[");
    for (i, h) in outline.iter().enumerate() {
        if i > 0 {
            meta.push(',');
        }
        let _ = write!(meta, "{{\"level\":{},\"line\":{},\"id\":", h.level, h.line);
        json_str(&mut meta, &h.id);
        meta.push_str(",\"text\":");
        json_str(&mut meta, h.text.trim());
        meta.push('}');
    }
    let _ = write!(
        meta,
        "],\"words\":{words},\"chars\":{chars},\"charsNoSpace\":{chars_no_space},\"lines\":{},\
         \"tasks\":{tasks},\"tasksDone\":{tasks_done},\"links\":{links},\"images\":{images},\
         \"codeBlocks\":{code_blocks},\"tables\":{tables},\"math\":{math},\"frontmatter\":",
        line_starts.len()
    );
    json_str(&mut meta, &frontmatter);
    meta.push('}');

    (html, meta)
}

fn finish_heading(h: PendingHeading, events: &mut [Event], slugs: &mut HashMap<String, usize>, outline: &mut Vec<OutlineItem>) {
    let Event::Start(Tag::Heading { level, id, classes, attrs }) = std::mem::replace(&mut events[h.event_index], Event::SoftBreak) else {
        unreachable!("heading index always points at its start tag")
    };
    let base = match &id {
        Some(explicit) => explicit.to_string(),
        None => slugify(&h.text),
    };
    let n = slugs.entry(base.clone()).or_insert(0);
    let unique = if *n == 0 { base } else { format!("{base}-{n}") };
    *n += 1;
    outline.push(OutlineItem { level: level as u8, text: emoji::expand(&h.text), id: unique.clone(), line: h.line });
    events[h.event_index] = Event::Start(Tag::Heading { level, id: Some(CowStr::from(unique)), classes, attrs });
}

/// GitHub-style heading slug.
pub fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.trim().chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' {
            out.extend(c.to_lowercase());
        } else if c.is_whitespace() {
            out.push('-');
        }
    }
    if out.is_empty() {
        out.push_str("section");
    }
    out
}

fn flush_text(buf: &mut String, out: &mut Vec<Event>, flags: u32) {
    if !buf.is_empty() {
        enrich_text(buf, out, flags);
        buf.clear();
    }
}

/// Adds the "extended" inline syntax pulldown-cmark doesn't know:
/// `:emoji:` shortcodes, bare URL autolinks, `==highlight==`, and intraword
/// `x^2^` / `H~2~O` (pulldown-cmark only accepts these at word boundaries).
fn enrich_text(t: &str, out: &mut Vec<Event>, flags: u32) {
    let b = t.as_bytes();
    let (mut i, mut last) = (0usize, 0usize);
    let mut mark_open = false;
    let push_plain = |out: &mut Vec<Event>, from: usize, to: usize| {
        if to > from {
            out.push(Event::Text(CowStr::from(t[from..to].to_string())));
        }
    };

    while i < b.len() {
        let c = b[i];
        // :shortcode:
        if c == b':' {
            if let Some(end) = t[i + 1..].find(':') {
                let name = &t[i + 1..i + 1 + end];
                if (1..40).contains(&name.len())
                    && name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'+' | b'-'))
                {
                    if let Some(e) = emoji::lookup(name) {
                        push_plain(out, last, i);
                        out.push(Event::Text(CowStr::Borrowed(e)));
                        i += end + 2;
                        last = i;
                        continue;
                    }
                }
            }
        }
        // bare URLs
        if (c == b'h' || c == b'w') && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) {
            let rest = &t[i..];
            let prefix = ["https://", "http://", "www."].iter().find(|p| rest.starts_with(**p));
            if let Some(prefix) = prefix {
                let mut end = rest
                    .find(|ch: char| ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '`'))
                    .unwrap_or(rest.len());
                loop {
                    let s = &rest[..end];
                    let trailing_punct = s.ends_with(['.', ',', ';', ':', '!', '?', '\'', '*', '_', '~']);
                    let unbalanced_paren = s.ends_with(')') && s.matches('(').count() < s.matches(')').count();
                    if trailing_punct || unbalanced_paren {
                        end -= 1;
                    } else {
                        break;
                    }
                }
                if end > prefix.len() + 1 {
                    let url = &rest[..end];
                    let href = if *prefix == "www." { format!("https://{url}") } else { url.to_string() };
                    push_plain(out, last, i);
                    out.push(Event::InlineHtml(format!("<a href=\"{}\" class=\"autolink\">", escape_attr(&href)).into()));
                    out.push(Event::Text(CowStr::from(url.to_string())));
                    out.push(Event::InlineHtml(CowStr::Borrowed("</a>")));
                    i += end;
                    last = i;
                    continue;
                }
            }
        }
        // ^sup^ and (opt-in) ~sub~
        if c == b'^' || (c == b'~' && flags & FLAG_SUBSCRIPT != 0) {
            if let Some(end) = t[i + 1..].find(c as char) {
                let inner = &t[i + 1..i + 1 + end];
                if (1..=40).contains(&inner.len()) && !inner.contains(char::is_whitespace) {
                    let tag = if c == b'^' { "sup" } else { "sub" };
                    push_plain(out, last, i);
                    out.push(Event::InlineHtml(format!("<{tag}>").into()));
                    out.push(Event::Text(CowStr::from(inner.to_string())));
                    out.push(Event::InlineHtml(format!("</{tag}>").into()));
                    i += end + 2;
                    last = i;
                    continue;
                }
            }
        }
        // ==highlight==
        if c == b'=' && b.get(i + 1) == Some(&b'=') {
            let opens = !mark_open
                && b.get(i + 2).is_some_and(|n| !n.is_ascii_whitespace() && *n != b'=')
                && t[i + 2..].contains("==");
            if mark_open || opens {
                push_plain(out, last, i);
                out.push(Event::InlineHtml(CowStr::Borrowed(if mark_open { "</mark>" } else { "<mark>" })));
                mark_open = !mark_open;
                i += 2;
                last = i;
                continue;
            }
        }
        i += 1;
    }
    push_plain(out, last, b.len());
    if mark_open {
        out.push(Event::InlineHtml(CowStr::Borrowed("</mark>")));
    }
}

fn escape_attr(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '"' => o.push_str("&quot;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            _ => o.push(c),
        }
    }
    o
}

fn json_str(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

// ---------------------------------------------------------------------------
// Table formatter
// ---------------------------------------------------------------------------

pub fn format_tables_str(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut cursor = 0usize;
    for (ev, range) in Parser::new_ext(src, options(0)).into_offset_iter() {
        let Event::Start(Tag::Table(aligns)) = ev else { continue };
        // Extend to the full first line so indentation is preserved.
        let start = src[..range.start].rfind('\n').map_or(0, |i| i + 1);
        if start < cursor {
            continue;
        }
        let block = &src[start..range.end];
        if let Some(formatted) = format_one_table(block, &aligns) {
            out.push_str(&src[cursor..start]);
            out.push_str(&formatted);
            cursor = range.end;
        }
    }
    out.push_str(&src[cursor..]);
    out
}

fn split_row(line: &str) -> Vec<String> {
    let mut s = line.trim();
    s = s.strip_prefix('|').unwrap_or(s);
    if s.ends_with('|') && !s.ends_with("\\|") {
        s = &s[..s.len() - 1];
    }
    let mut cells = Vec::new();
    let mut cur = String::new();
    let mut in_code = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                cur.push(c);
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            '`' => {
                in_code = !in_code;
                cur.push(c);
            }
            '|' if !in_code => cells.push(std::mem::take(&mut cur).trim().to_string()),
            _ => cur.push(c),
        }
    }
    cells.push(cur.trim().to_string());
    cells
}

fn format_one_table(block: &str, aligns: &[pulldown_cmark::Alignment]) -> Option<String> {
    use pulldown_cmark::Alignment as A;
    let lines: Vec<&str> = block.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() < 2 || lines.iter().any(|l| l.trim_start().starts_with('>')) {
        return None;
    }
    let indent: String = lines[0].chars().take_while(|c| c.is_whitespace()).collect();
    let cols = aligns.len();
    let rows: Vec<Vec<String>> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != 1)
        .map(|(_, l)| {
            let mut r = split_row(l);
            r.resize(cols, String::new());
            r
        })
        .collect();
    let widths: Vec<usize> = (0..cols)
        .map(|c| rows.iter().map(|r| UnicodeWidthStr::width(r[c].as_str())).max().unwrap_or(0).max(3))
        .collect();

    let pad = |cell: &str, w: usize, a: A| {
        let gap = w.saturating_sub(UnicodeWidthStr::width(cell));
        match a {
            A::Right => format!("{}{}", " ".repeat(gap), cell),
            A::Center => format!("{}{}{}", " ".repeat(gap / 2), cell, " ".repeat(gap - gap / 2)),
            _ => format!("{}{}", cell, " ".repeat(gap)),
        }
    };
    let render_row = |r: &Vec<String>| {
        let cells: Vec<String> = (0..cols).map(|c| pad(&r[c], widths[c], aligns[c])).collect();
        format!("{indent}| {} |", cells.join(" | "))
    };

    let mut out = Vec::with_capacity(rows.len() + 1);
    out.push(render_row(&rows[0]));
    let delim: Vec<String> = (0..cols)
        .map(|c| {
            let w = widths[c];
            match aligns[c] {
                A::Left => format!(":{}", "-".repeat(w - 1)),
                A::Right => format!("{}:", "-".repeat(w - 1)),
                A::Center => format!(":{}:", "-".repeat(w - 2)),
                A::None => "-".repeat(w),
            }
        })
        .collect();
    out.push(format!("{indent}| {} |", delim.join(" | ")));
    out.extend(rows[1..].iter().map(render_row));
    let mut s = out.join("\n");
    if block.ends_with('\n') {
        s.push('\n');
    }
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_extended_syntax() {
        let (html, meta) = render_markdown(
            "---\ntitle: Hi\n---\n# Hello *World*\n\n- [ ] a\n- [x] b\n\nSee https://example.com/a_b. :rocket: ==hot== $x^2$\n\n# Hello World\n",
            0,
        );
        assert!(html.contains("id=\"hello-world\""), "{html}");
        assert!(html.contains("id=\"hello-world-1\""), "{html}");
        assert!(html.contains("<a href=\"https://example.com/a_b\" class=\"autolink\">"), "{html}");
        assert!(html.contains("🚀"));
        assert!(html.contains("<mark>hot</mark>"));
        assert!(html.contains("math-inline"));
        assert!(html.contains("data-offset=\"37\""), "{html}");
        assert!(meta.contains("\"tasks\":2,\"tasksDone\":1"), "{meta}");
        assert!(meta.contains("\"frontmatter\":\"title: Hi\\n\""), "{meta}");
        assert!(!html.contains("title: Hi"));
    }

    #[test]
    fn intraword_sup_sub_and_outline_emoji() {
        let (html, _) = render_markdown("x^2^ and H~2~O and ~~gone~~", FLAG_SUBSCRIPT);
        assert!(html.contains("x<sup>2</sup>"), "{html}");
        assert!(html.contains("H<sub>2</sub>O"), "{html}");
        assert!(html.contains("<del>gone</del>"), "{html}");
        let (plain, _) = render_markdown("H~2~O", 0);
        assert!(!plain.contains("<sub>"), "{plain}");
        let (_, meta) = render_markdown("# Launch :rocket:", 0);
        assert!(meta.contains("\"text\":\"Launch 🚀\""), "{meta}");
        assert!(meta.contains("\"id\":\"launch-rocket\""), "{meta}");
    }

    #[test]
    fn formats_tables() {
        let src = "Intro\n\n|a|bb|c|\n|:-|:-:|-:|\n|long cell|x|1|\n\nafter\n";
        let out = format_tables_str(src);
        assert_eq!(
            out,
            "Intro\n\n| a         | bb  |   c |\n| :-------- | :-: | --: |\n| long cell |  x  |   1 |\n\nafter\n"
        );
    }
}
