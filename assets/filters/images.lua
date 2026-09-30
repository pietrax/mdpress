-- mdpress: prepares images for Typst output.
-- MDPRESS_BASE: folder of the md file (for relative paths); MDPRESS_WORKDIR: where remote images are saved.
-- Problems are reported on stderr as mdpress:image-not-found:<src> and mdpress:image-unreachable:<src>.
local base = os.getenv('MDPRESS_BASE')
local workdir = os.getenv('MDPRESS_WORKDIR')
local count = 0

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
      io.stderr:write('mdpress:image-unreachable:' .. src .. '\n')
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

  -- pandoc passes local sources percent-encoded: try the literal path, then the decoded one.
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
    io.stderr:write('mdpress:image-not-found:' .. src .. '\n')
    return img.caption
  end
  img.src = path
  return img
end
