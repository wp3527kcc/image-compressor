const { ensureAuthSchema, getDb } = require('./db');

function normalizeMediaType(type) {
  const value = String(type || '').toLowerCase();
  if (value.startsWith('image')) return 'image';
  if (value.startsWith('video')) return 'video';
  if (value === 'image' || value === 'video') return value;
  return 'unknown';
}

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function mapHistoryRow(row) {
  const originalSize = Number(row.original_size) || 0;
  const compressedSize = row.compressed_size === null ? null : Number(row.compressed_size);
  const savedBytes = compressedSize === null ? null : Math.max(0, originalSize - compressedSize);

  return {
    id: row.id,
    eventType: row.event_type,
    mediaType: row.media_type,
    originalName: row.original_name,
    originalSize,
    compressedSize,
    outputFilename: row.output_filename || null,
    outputFormat: row.output_format || null,
    sourcePathname: row.source_pathname || null,
    resultPathname: row.result_pathname || null,
    sourceUrl: row.source_url || null,
    resultUrl: row.result_url || null,
    downloadUrl: row.result_url || row.source_url || null,
    compressionRatio: row.compression_ratio === null ? null : Number(row.compression_ratio).toFixed(1),
    savedBytes,
    createdAt: row.created_at,
  };
}

async function addUploadHistory(userId, file) {
  await ensureAuthSchema();
  const sql = getDb();
  await sql`
    INSERT INTO auth_media_history (
      user_id,
      event_type,
      media_type,
      original_name,
      original_size,
      source_pathname,
      source_url
    )
    VALUES (
      ${userId}::uuid,
      'upload',
      ${normalizeMediaType(file?.type)},
      ${String(file?.name || 'unknown')},
      ${toNumber(file?.size, 0)},
      ${String(file?.pathname || '') || null},
      ${String(file?.downloadUrl || file?.url || '') || null}
    )
  `;
}

async function addCompressionHistory(userId, sourceFile, result) {
  await ensureAuthSchema();
  const sql = getDb();
  await sql`
    INSERT INTO auth_media_history (
      user_id,
      event_type,
      media_type,
      original_name,
      original_size,
      compressed_size,
      output_filename,
      output_format,
      source_pathname,
      result_pathname,
      source_url,
      result_url,
      compression_ratio
    )
    VALUES (
      ${userId}::uuid,
      'compress',
      ${normalizeMediaType(result?.mediaType || sourceFile?.type)},
      ${String(result?.originalName || sourceFile?.name || 'unknown')},
      ${toNumber(result?.originalSize || sourceFile?.size, 0)},
      ${toNumber(result?.compressedSize, null)},
      ${String(result?.outputFilename || '') || null},
      ${String(result?.outputFormat || '') || null},
      ${String(sourceFile?.pathname || '') || null},
      ${String(result?.pathname || '') || null},
      ${String(sourceFile?.downloadUrl || sourceFile?.url || '') || null},
      ${String(result?.downloadUrl || result?.url || '') || null},
      ${toNumber(result?.compressionRatio, null)}
    )
  `;
}

async function listUserHistory(userId, limit = 100) {
  await ensureAuthSchema();
  const sql = getDb();
  const safeLimit = Math.max(1, Math.min(200, Number.parseInt(String(limit || '100'), 10) || 100));
  const rows = await sql`
    SELECT
      id,
      event_type,
      media_type,
      original_name,
      original_size,
      compressed_size,
      output_filename,
      output_format,
      source_pathname,
      result_pathname,
      source_url,
      result_url,
      compression_ratio,
      created_at
    FROM auth_media_history
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;

  return rows.map(mapHistoryRow);
}

async function clearUserHistory(userId) {
  await ensureAuthSchema();
  const sql = getDb();
  const rows = await sql`
    DELETE FROM auth_media_history
    WHERE user_id = ${userId}::uuid
    RETURNING id
  `;
  return rows.length;
}

module.exports = {
  addCompressionHistory,
  addUploadHistory,
  clearUserHistory,
  listUserHistory,
};
