-- mdpress: copertina, campi del blocco titolo e interruzioni di pagina per l'output DOCX.
-- I parametri arrivano da variabili d'ambiente MDPRESS_* impostate da render.ts.
local function env(name)
  local v = os.getenv(name)
  if v == nil or v == '' then
    return nil
  end
  return v
end

local function selected_fields()
  local raw = env('MDPRESS_FIELDS')
  if not raw then
    return nil
  end
  local keep = {}
  for field in raw:gmatch('[^,]+') do
    keep[field] = true
  end
  return keep
end

-- La numerazione dei titoli si ferma al livello 3, come nel PDF.
function Header(h)
  if h.level > 3 and not h.classes:includes('unnumbered') then
    h.classes:insert('unnumbered')
  end
  return h
end

local function as_inlines(value)
  if pandoc.utils.type(value) == 'Inlines' then
    return value
  end
  return pandoc.Inlines(pandoc.utils.stringify(value))
end

function Pandoc(doc)
  local meta = doc.meta
  local keep = selected_fields()
  if keep then
    for _, key in ipairs({ 'title', 'subtitle', 'author', 'date' }) do
      if not keep[key] then
        meta[key] = nil
      end
    end
  end

  local cover = env('MDPRESS_COVER') ~= nil
  local fallback = env('MDPRESS_FALLBACK_TITLE')
  if cover and meta.title == nil and fallback and (keep == nil or keep.title) then
    meta.title = pandoc.Inlines(fallback)
  end

  local logo = env('MDPRESS_LOGO')
  if cover and logo and meta.title ~= nil then
    local image = pandoc.Image({ pandoc.Str('Logo') }, logo, '', { height = env('MDPRESS_LOGO_HEIGHT') or '24mm' })
    meta.title = pandoc.Inlines({ image, pandoc.LineBreak() }) .. as_inlines(meta.title)
  end

  if cover or env('MDPRESS_TOC') then
    doc.blocks:insert(1, pandoc.RawBlock('openxml', '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'))
  end
  doc.meta = meta
  return doc
end

return { { Header = Header }, { Pandoc = Pandoc } }
