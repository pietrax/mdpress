-- mdpress: prepara le immagini per l'output Typst.
-- MDPRESS_BASE: cartella dell'md (per i percorsi relativi); MDPRESS_WORKDIR: dove salvare le immagini remote.
local base = os.getenv('MDPRESS_BASE')
local workdir = os.getenv('MDPRESS_WORKDIR')
local count = 0

local function warn(message)
  io.stderr:write('mdpress: ' .. message .. '\n')
end

local function exists(path)
  local f = io.open(path, 'rb')
  if f then
    f:close()
    return true
  end
  return false
end

function Image(img)
  local src = img.src
  if src:match('^data:') then
    return nil
  end

  if src:match('^https?://') then
    local ok, mime, contents = pcall(pandoc.mediabag.fetch, src)
    if not ok or not contents or not workdir then
      warn('immagine non raggiungibile, sostituita dal testo alternativo: ' .. src)
      return img.caption
    end
    count = count + 1
    local ext = (mime and mime:match('image/(%a+)')) or 'png'
    if ext == 'jpeg' then
      ext = 'jpg'
    end
    local path = pandoc.path.join({ workdir, 'remote-' .. count .. '.' .. ext })
    local f = assert(io.open(path, 'wb'))
    f:write(contents)
    f:close()
    img.src = path
    return img
  end

  -- pandoc passa le sorgenti locali percent-encoded: prova il percorso letterale, poi quello decodificato.
  local decoded = src:gsub('%%(%x%x)', function(h)
    return string.char(tonumber(h, 16))
  end)
  local function resolve(candidate)
    if base and not pandoc.path.is_absolute(candidate) then
      return pandoc.path.normalize(pandoc.path.join({ base, candidate }))
    end
    return candidate
  end
  local path = resolve(src)
  if not exists(path) then
    path = resolve(decoded)
  end
  if not exists(path) then
    warn('immagine non trovata, sostituita dal testo alternativo: ' .. src)
    return img.caption
  end
  img.src = path
  return img
end
