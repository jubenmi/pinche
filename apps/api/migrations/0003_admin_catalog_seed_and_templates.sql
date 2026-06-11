SET @pinche_d3_add_script_template = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE scripts ADD COLUMN default_seat_template_json JSON NULL AFTER summary_no_spoiler',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'scripts'
    AND column_name = 'default_seat_template_json'
);
PREPARE pinche_d3_stmt FROM @pinche_d3_add_script_template;
EXECUTE pinche_d3_stmt;
DEALLOCATE PREPARE pinche_d3_stmt;

INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '朝阳情感车站', '北京', '朝阳', '朝阳北路88号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '朝阳情感车站');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '三里屯沉浸馆', '北京', '朝阳', '工体北路21号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '三里屯沉浸馆');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '望京夜航剧场', '北京', '朝阳', '望京街9号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '望京夜航剧场');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '五道口拼车局', '北京', '海淀', '成府路35号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '五道口拼车局');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '中关村故事社', '北京', '海淀', '海淀大街1号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '中关村故事社');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '西单落日剧本馆', '北京', '西城', '西单北大街66号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '西单落日剧本馆');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '东直门月台', '北京', '东城', '东直门内大街18号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '东直门月台');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '双井长夜推理社', '北京', '朝阳', '广渠路12号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '双井长夜推理社');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '大望路限定车', '北京', '朝阳', '建国路91号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '大望路限定车');
INSERT INTO stores (name, city, district, address, contact_note, status, claim_status)
SELECT '宋家庄南城本社', '北京', '丰台', '顺八条6号', 'D3 seed store', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name = '宋家庄南城本社');

INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '落日来信', '["情感","恋陪","现代"]', 6, '现代情感陪伴本，适合车头指定爱D。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主陪位","basePrice":58000,"adjustment":20000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP位","basePrice":58000,"adjustment":-5000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP位","basePrice":58000,"adjustment":-5000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP位","basePrice":58000,"adjustment":-5000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP位","basePrice":58000,"adjustment":-5000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '落日来信');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '月台第七封信', '["情感","恋陪"]', 6, '偏陪伴和输出的恋陪本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"高光位","basePrice":62000,"adjustment":16000},{"name":"CP位A","seatType":"f4","roleName":"玩家CP","basePrice":62000,"adjustment":-4000},{"name":"CP位B","seatType":"f4","roleName":"玩家CP","basePrice":62000,"adjustment":-4000},{"name":"CP位C","seatType":"f4","roleName":"玩家CP","basePrice":62000,"adjustment":-4000},{"name":"CP位D","seatType":"f4","roleName":"玩家CP","basePrice":62000,"adjustment":-4000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '月台第七封信');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '风吹过南锣', '["情感","都市"]', 6, '都市情感本，角色互动密集。', '[{"name":"大C位","seatType":"love_companion","roleName":"主线位","basePrice":52000,"adjustment":12000},{"name":"红光位","seatType":"normal","roleName":"输出位","basePrice":52000,"adjustment":0},{"name":"CP位1","seatType":"f4","roleName":"玩家CP","basePrice":52000,"adjustment":-3000},{"name":"CP位2","seatType":"f4","roleName":"玩家CP","basePrice":52000,"adjustment":-3000},{"name":"CP位3","seatType":"f4","roleName":"玩家CP","basePrice":52000,"adjustment":-3000},{"name":"CP位4","seatType":"f4","roleName":"玩家CP","basePrice":52000,"adjustment":-3000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '风吹过南锣');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '冬夜不散场', '["情感","沉浸"]', 5, '小体量情感沉浸本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主陪位","basePrice":48000,"adjustment":12000},{"name":"CP位1","seatType":"f4","roleName":"玩家CP","basePrice":48000,"adjustment":-3000},{"name":"CP位2","seatType":"f4","roleName":"玩家CP","basePrice":48000,"adjustment":-3000},{"name":"CP位3","seatType":"f4","roleName":"玩家CP","basePrice":48000,"adjustment":-3000},{"name":"CP位4","seatType":"f4","roleName":"玩家CP","basePrice":48000,"adjustment":-3000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '冬夜不散场');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '昨日晴空', '["情感","恋陪","校园"]', 6, '校园回忆向情感本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主线位","basePrice":56000,"adjustment":20000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":56000,"adjustment":-5000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":56000,"adjustment":-5000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":56000,"adjustment":-5000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":56000,"adjustment":-5000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '昨日晴空');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '星河未读', '["情感","科幻轻设定"]', 6, '轻设定情感本，适合熟人车。', '[{"name":"主光位","seatType":"love_companion","roleName":"高光位","basePrice":59000,"adjustment":12000},{"name":"输出位","seatType":"normal","roleName":"红光位","basePrice":59000,"adjustment":0},{"name":"CP位1","seatType":"f4","roleName":"玩家CP","basePrice":59000,"adjustment":-3000},{"name":"CP位2","seatType":"f4","roleName":"玩家CP","basePrice":59000,"adjustment":-3000},{"name":"CP位3","seatType":"f4","roleName":"玩家CP","basePrice":59000,"adjustment":-3000},{"name":"CP位4","seatType":"f4","roleName":"玩家CP","basePrice":59000,"adjustment":-3000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '星河未读');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '长安旧梦', '["情感","古风"]', 6, '古风情感沉浸。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主陪位","basePrice":66000,"adjustment":20000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":66000,"adjustment":-5000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":66000,"adjustment":-5000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":66000,"adjustment":-5000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":66000,"adjustment":-5000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '长安旧梦');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '霓虹尽头', '["情感","都市","强互动"]', 6, '都市强互动情感本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"C位","basePrice":68000,"adjustment":16000},{"name":"CP位A","seatType":"f4","roleName":"玩家CP","basePrice":68000,"adjustment":-4000},{"name":"CP位B","seatType":"f4","roleName":"玩家CP","basePrice":68000,"adjustment":-4000},{"name":"CP位C","seatType":"f4","roleName":"玩家CP","basePrice":68000,"adjustment":-4000},{"name":"CP位D","seatType":"f4","roleName":"玩家CP","basePrice":68000,"adjustment":-4000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '霓虹尽头');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '海棠无声', '["情感","民国"]', 6, '民国情感本，适合沉浸玩家。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主线位","basePrice":64000,"adjustment":20000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":64000,"adjustment":-5000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":64000,"adjustment":-5000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":64000,"adjustment":-5000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":64000,"adjustment":-5000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '海棠无声');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '今夜无人告别', '["情感","恋陪"]', 6, '恋陪向情感本，适合多刷车。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主陪位","basePrice":72000,"adjustment":24000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":72000,"adjustment":-6000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":72000,"adjustment":-6000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":72000,"adjustment":-6000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":72000,"adjustment":-6000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '今夜无人告别');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '北纬四十度', '["情感","现实"]', 6, '现实向情感本。', '[{"name":"高光位","seatType":"love_companion","roleName":"大C","basePrice":54000,"adjustment":12000},{"name":"红光位","seatType":"normal","roleName":"输出位","basePrice":54000,"adjustment":0},{"name":"CP位1","seatType":"f4","roleName":"玩家CP","basePrice":54000,"adjustment":-3000},{"name":"CP位2","seatType":"f4","roleName":"玩家CP","basePrice":54000,"adjustment":-3000},{"name":"CP位3","seatType":"f4","roleName":"玩家CP","basePrice":54000,"adjustment":-3000},{"name":"CP位4","seatType":"f4","roleName":"玩家CP","basePrice":54000,"adjustment":-3000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '北纬四十度');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '槐花落满街', '["情感","年代"]', 6, '年代情感沉浸本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主线位","basePrice":61000,"adjustment":20000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":61000,"adjustment":-5000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":61000,"adjustment":-5000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":61000,"adjustment":-5000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":61000,"adjustment":-5000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '槐花落满街');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '白昼烟火', '["情感","治愈"]', 5, '治愈向情感本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主陪位","basePrice":50000,"adjustment":12000},{"name":"CP位1","seatType":"f4","roleName":"玩家CP","basePrice":50000,"adjustment":-3000},{"name":"CP位2","seatType":"f4","roleName":"玩家CP","basePrice":50000,"adjustment":-3000},{"name":"CP位3","seatType":"f4","roleName":"玩家CP","basePrice":50000,"adjustment":-3000},{"name":"CP位4","seatType":"f4","roleName":"玩家CP","basePrice":50000,"adjustment":-3000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '白昼烟火');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '晚风替我拥抱你', '["情感","恋陪","现代"]', 6, '恋陪强互动现代情感本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"爱D对位","basePrice":76000,"adjustment":24000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":76000,"adjustment":-6000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":76000,"adjustment":-6000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":76000,"adjustment":-6000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":76000,"adjustment":-6000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '晚风替我拥抱你');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '旧照片里的雨', '["情感","回忆"]', 6, '回忆向情感本。', '[{"name":"高光位","seatType":"love_companion","roleName":"主线位","basePrice":53000,"adjustment":16000},{"name":"CP位A","seatType":"f4","roleName":"玩家CP","basePrice":53000,"adjustment":-4000},{"name":"CP位B","seatType":"f4","roleName":"玩家CP","basePrice":53000,"adjustment":-4000},{"name":"CP位C","seatType":"f4","roleName":"玩家CP","basePrice":53000,"adjustment":-4000},{"name":"CP位D","seatType":"f4","roleName":"玩家CP","basePrice":53000,"adjustment":-4000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '旧照片里的雨');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '二环以北', '["情感","都市"]', 6, '北京都市情感本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"C位","basePrice":57000,"adjustment":20000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":57000,"adjustment":-5000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":57000,"adjustment":-5000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":57000,"adjustment":-5000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":57000,"adjustment":-5000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '二环以北');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '雾色机场', '["情感","悬疑轻推理"]', 6, '轻推理外壳的情感本。', '[{"name":"大C位","seatType":"love_companion","roleName":"主线位","basePrice":60000,"adjustment":12000},{"name":"红光位","seatType":"normal","roleName":"输出位","basePrice":60000,"adjustment":0},{"name":"CP位1","seatType":"f4","roleName":"玩家CP","basePrice":60000,"adjustment":-3000},{"name":"CP位2","seatType":"f4","roleName":"玩家CP","basePrice":60000,"adjustment":-3000},{"name":"CP位3","seatType":"f4","roleName":"玩家CP","basePrice":60000,"adjustment":-3000},{"name":"CP位4","seatType":"f4","roleName":"玩家CP","basePrice":60000,"adjustment":-3000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '雾色机场');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '银河换乘站', '["情感","恋陪","轻幻想"]', 6, '轻幻想恋陪情感本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"爱D对位","basePrice":74000,"adjustment":24000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":74000,"adjustment":-6000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":74000,"adjustment":-6000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":74000,"adjustment":-6000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":74000,"adjustment":-6000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '银河换乘站');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '山海见你', '["情感","古风","恋陪"]', 6, '古风恋陪本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"主陪位","basePrice":70000,"adjustment":20000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":70000,"adjustment":-5000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":70000,"adjustment":-5000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":70000,"adjustment":-5000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":70000,"adjustment":-5000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '山海见你');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '重逢在鼓楼西', '["情感","北京","现实"]', 6, '北京现实向情感本。', '[{"name":"主线位","seatType":"love_companion","roleName":"高光位","basePrice":55000,"adjustment":16000},{"name":"CP位A","seatType":"f4","roleName":"玩家CP","basePrice":55000,"adjustment":-4000},{"name":"CP位B","seatType":"f4","roleName":"玩家CP","basePrice":55000,"adjustment":-4000},{"name":"CP位C","seatType":"f4","roleName":"玩家CP","basePrice":55000,"adjustment":-4000},{"name":"CP位D","seatType":"f4","roleName":"玩家CP","basePrice":55000,"adjustment":-4000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '重逢在鼓楼西');
INSERT INTO scripts (name, type_tags, player_count, summary_no_spoiler, default_seat_template_json, status, claim_status)
SELECT '星光借位', '["情感","娱乐圈","恋陪"]', 6, '娱乐圈设定恋陪本。', '[{"name":"恋陪位","seatType":"love_companion","roleName":"爱D对位","basePrice":78000,"adjustment":24000},{"name":"F4-1","seatType":"f4","roleName":"玩家CP","basePrice":78000,"adjustment":-6000},{"name":"F4-2","seatType":"f4","roleName":"玩家CP","basePrice":78000,"adjustment":-6000},{"name":"F4-3","seatType":"f4","roleName":"玩家CP","basePrice":78000,"adjustment":-6000},{"name":"F4-4","seatType":"f4","roleName":"玩家CP","basePrice":78000,"adjustment":-6000}]', 'active', 'unclaimed'
WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE name = '星光借位');
