#!/usr/bin/env python3
"""
班級作業登記系統 - 單元測試自動驗證腳本
可在終端機直接執行：python3 test/run_tests.py
"""

import sys
import json
from datetime import datetime

class TestRunner:
    def __init__(self):
        self.passes = 0
        self.failures = []

    def assert_equal(self, actual, expected, msg=""):
        if actual != expected:
            raise AssertionError(f"{msg}: Expected {expected!r}, got {actual!r}")
        self.passes += 1

    def assert_deep_equal(self, actual, expected, msg=""):
        if json.dumps(actual, sort_keys=True) != json.dumps(expected, sort_keys=True):
            raise AssertionError(f"{msg}: Expected {expected!r}, got {actual!r}")
        self.passes += 1

def run_tests():
    t = TestRunner()
    print("=== 開始執行班級作業登記系統業務規則單元測試 ===")

    # 1. 座位排序規則
    def sort_by_seat(students):
        def seat_key(s):
            seat = s.get('seat')
            if seat is None or seat == '':
                return (1, 0, s.get('name', ''))
            return (0, int(seat), s.get('name', ''))
        return sorted(students, key=seat_key)

    students = [
        {'name': '王大明', 'seat': '15'},
        {'name': '李小華', 'seat': '2'},
        {'name': '陳無號', 'seat': ''},
        {'name': '張同號A', 'seat': '5'},
        {'name': '白同號B', 'seat': '5'},
        {'name': '林無號2', 'seat': None}
    ]
    sorted_s = sort_by_seat(students)
    t.assert_equal(sorted_s[0]['name'], '李小華', "最小座號應排最前")
    t.assert_equal(sorted_s[1]['seat'], '5', "座號 5 號學生排在前")
    t.assert_equal(sorted_s[4].get('seat') in ('', None), True, "無座號置底")
    t.assert_equal(sorted_s[5].get('seat') in ('', None), True, "無座號置底")

    # 2. 抽離上課判斷
    def is_pulled_out(student, subject, assignment_name=''):
        if not student or not student.get('pullout'):
            return False
        combined = f"{subject or ''} {assignment_name or ''}".strip()
        p = student['pullout']
        if '國' in combined and p.get('chinese'):
            return True
        if '數' in combined and p.get('math'):
            return True
        return False

    def is_record_pulled_out(record, student, subject='', assignment_name=''):
        if record and record.get('pulledOut'):
            return True
        if student:
            return is_pulled_out(student, subject, assignment_name or (record.get('assignmentName') if record else ''))
        return False

    s1 = {'name': 'A', 'pullout': {'chinese': True, 'math': False}}
    s2 = {'name': 'B', 'pullout': {'chinese': False, 'math': True}}
    s3 = {'name': 'C', 'pullout': None}
    t.assert_equal(is_pulled_out(s1, '國語'), True, "國語抽離判定")
    t.assert_equal(is_pulled_out(s1, '數學'), False, "國語抽離但在數學不應被抽離")
    t.assert_equal(is_pulled_out(s2, '數學'), True, "數學抽離判定")
    t.assert_equal(is_pulled_out(s1, '', '國語習作'), True, "科目為空但作業包含國語應抽離")
    t.assert_equal(is_pulled_out(s1, '未分類', '2026/09/25 國習 p.10'), True, "科目未分類但作業包含國字應抽離")
    t.assert_equal(is_pulled_out(s2, '', '數課第三單元'), True, "作業包含數課應抽離")
    t.assert_equal(is_pulled_out(s1, '', '英文閱讀'), False, "非國數作業不應抽離")

    t.assert_equal(is_record_pulled_out({'pulledOut': True}, s3, '自然'), True, "歷史快照標記抽離應直接為 True")
    t.assert_equal(is_record_pulled_out({'pulledOut': False, 'assignmentName': '國語生字簿'}, s1, ''), True, "快照為 False 但學生抽離國語應回退為 True")
    t.assert_equal(is_record_pulled_out(None, s2, '數學'), True, "無快照但學生抽離數學應為 True")
    t.assert_equal(is_record_pulled_out(None, s1, '自然', '昆蟲紀錄'), False, "非抽離科目應為 False")

    # 3. 點數計算規則
    def points_of(g, assignments, fallback_meta=None):
        if not g:
            return 0
        name = g.get('assignmentName', '')
        if name == '聯絡簿每日任務':
            return 0
        for kw in ['卷', '考', '聽', '測驗']:
            if kw in name:
                return 0
        
        asg = next((a for a in assignments if a['id'] == g.get('assignmentId')), None)
        is_sign_only = asg.get('signOnly') if asg else (fallback_meta.get('signOnly') if fallback_meta else False)
        if is_sign_only:
            return 0

        c = g.get('correctness')
        if c == '全對':
            return 10
        if c == '有錯' and g.get('corrected'):
            return 5
        return 0

    asgs = [
        {'id': 'a1', 'name': '數學習作', 'signOnly': False},
        {'id': 'a2', 'name': '家長回條', 'signOnly': True},
        {'id': 'a3', 'name': '期中考卷', 'signOnly': False}
    ]
    t.assert_equal(points_of({'assignmentId': 'a1', 'assignmentName': '數學習作', 'correctness': '全對'}, asgs), 10, "一般作業全對 10 點")
    t.assert_equal(points_of({'assignmentId': 'a1', 'assignmentName': '數學習作', 'correctness': '有錯', 'corrected': True}, asgs), 5, "訂正完成 5 點")
    t.assert_equal(points_of({'assignmentId': 'a1', 'assignmentName': '數學習作', 'correctness': '有錯', 'corrected': False}, asgs), 0, "未訂正 0 點")
    t.assert_equal(points_of({'assignmentId': 'a2', 'assignmentName': '家長回條', 'correctness': '全對'}, asgs), 0, "純簽名作業不給點")
    t.assert_equal(points_of({'assignmentId': 'a3', 'assignmentName': '期中考卷', 'correctness': '全對'}, asgs), 0, "考卷測驗不給點")
    
    # 封存作業配合 fallbackMeta 驗證
    archived_g = {'assignmentId': 'arch1', 'assignmentName': '舊回條', 'correctness': '全對'}
    t.assert_equal(points_of(archived_g, [], fallback_meta={'signOnly': True}), 0, "封存之純簽名作業不誤發點數")

    # 4. 上課日判斷
    def is_school_day(date_str, semester):
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        if semester.get('skipWeekends', True) and dt.weekday() in (5, 6):
            return False
        if semester.get('startDate') and date_str < semester['startDate']:
            return False
        if semester.get('endDate') and date_str > semester['endDate']:
            return False
        if date_str in semester.get('holidays', []):
            return False
        return True

    sem = {
        'startDate': '2026-09-01',
        'endDate': '2027-01-20',
        'skipWeekends': True,
        'holidays': ['2026-09-17']
    }
    t.assert_equal(is_school_day('2026-09-16', sem), True, "平日非假日應為上課日")
    t.assert_equal(is_school_day('2026-09-17', sem), False, "自訂假日不上課")
    t.assert_equal(is_school_day('2026-09-20', sem), False, "週末不上課")

    # 5. 加點匯出格式化（防 [object Object]）
    def format_items(items):
        if not items:
            return "無項目明細"
        parts = []
        for it in items:
            name = it.get('assignmentName', '作業')
            t_type = f"({it.get('type')})" if it.get('type') else ""
            pts = f"+{it.get('points')}點" if it.get('points') is not None else ""
            parts.append(f"{name}{t_type} {pts}".strip())
        return "、".join(parts)

    items = [
        {'assignmentName': '國語習作', 'type': '全對', 'points': 10},
        {'assignmentName': '數學習作', 'type': '訂正完成', 'points': 5}
    ]
    out = format_items(items)
    t.assert_equal(out, "國語習作(全對) +10點、數學習作(訂正完成) +5點", "不可有 [object Object]")

    # 6. 歷史作業按前綴日期排序（越新越前面）
    import re
    def get_assignment_date_key(info, aid=''):
        s = f"{info.get('dateLabel', '')} {info.get('name', '')} {aid}"
        m4 = re.search(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})', s)
        if m4:
            return f"{m4.group(1)}-{m4.group(2).zfill(2)}-{m4.group(3).zfill(2)}"
        m2 = re.search(r'(?:^|\s|[^\d])(\d{1,2})[/-](\d{1,2})(?:$|\s|[^\d])', s)
        if m2:
            return f"9999-{m2.group(1).zfill(2)}-{m2.group(2).zfill(2)}"
        return ""

    def sort_archived_assignments(entries):
        def sort_key(item):
            aid, info = item
            k = get_assignment_date_key(info, aid)
            return (0 if k else 1, "" if not k else k)
        # 降冪（越新日期越前）
        return sorted(entries, key=lambda x: get_assignment_date_key(x[1], x[0]), reverse=True)

    past_entries = [
        ('a1', {'name': '數習 p.10', 'dateLabel': '2026/09/14'}),
        ('a2', {'name': '數習 p.16～17', 'dateLabel': '2026/09/16'}),
        ('a3', {'name': '數習 p.12～13', 'dateLabel': '2026/09/15'}),
    ]
    sorted_past = sort_archived_assignments(past_entries)
    t.assert_equal(sorted_past[0][0], 'a2', '最新日期 09/16 應排在第 1 個')
    t.assert_equal(sorted_past[1][0], 'a3', '次新日期 09/15 應排在第 2 個')
    t.assert_equal(sorted_past[2][0], 'a1', '較舊日期 09/14 應排在第 3 個')

    # 7. 遺失作業即時更新（活資料覆蓋封存資料）
    def resolve_lost_assignments(students, live_grading, archive_docs_map):
        resolved = {}
        for doc in (archive_docs_map or {}).values():
            for r in doc.get('records', []):
                key = f"{r.get('studentId')}_{r.get('assignmentId')}"
                resolved[key] = {
                    'studentId': r.get('studentId'),
                    'assignmentId': r.get('assignmentId'),
                    'assignmentName': r.get('assignmentName', '作業'),
                    'correctness': r.get('correctness', '')
                }
        for g in (live_grading or []):
            key = f"{g.get('studentId')}_{g.get('assignmentId')}"
            existing = resolved.get(key, {})
            resolved[key] = {
                'studentId': g.get('studentId'),
                'assignmentId': g.get('assignmentId'),
                'assignmentName': g.get('assignmentName') or existing.get('assignmentName', '作業'),
                'correctness': g.get('correctness', '')
            }
        lost_counts = {s['id']: {'count': 0, 'assignments': []} for s in students}
        for item in resolved.values():
            if item.get('correctness') == '遺失':
                sid = item['studentId']
                if sid in lost_counts:
                    lost_counts[sid]['count'] += 1
                    lost_counts[sid]['assignments'].append(item['assignmentName'])
        return [{'id': s['id'], 'name': s['name'], **lost_counts[s['id']]} for s in students if lost_counts[s['id']]['count'] > 0]

    mock_students = [{'id': 's1', 'name': '學生甲'}, {'id': 's2', 'name': '學生乙'}]
    # 初始封存資料中，s1 遺失作業 a1
    mock_archives = {'arch1': {'records': [{'studentId': 's1', 'assignmentId': 'a1', 'assignmentName': '數習', 'correctness': '遺失'}]}}
    initial_lost = resolve_lost_assignments(mock_students, [], mock_archives)
    t.assert_equal(len(initial_lost), 1, "初始應有 1 位遺失作業")
    t.assert_equal(initial_lost[0]['id'], 's1', "遺失者為學生甲")

    # 老師點擊移除遺失鈕（live gradingRecords 寫入 correctness: ''）
    live_update = [{'studentId': 's1', 'assignmentId': 'a1', 'assignmentName': '數習', 'correctness': ''}]
    after_toggle_lost = resolve_lost_assignments(mock_students, live_update, mock_archives)
    t.assert_equal(len(after_toggle_lost), 0, "移除遺失後應即時清空，不再顯示為遺失作業")

    # 8. 加點作業日期提取
    def get_latest_date(eligible, archive_docs_map):
        max_d = None
        for g in eligible:
            aid = g['assignmentId']
            arch = archive_docs_map.get(aid, {})
            label = arch.get('dateLabel', '')
            m = re.search(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})', label)
            if m:
                d_str = f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"
                disp = f"{int(m.group(2))}月{int(m.group(3))}日"
                if not max_d or d_str > max_d[0]:
                    max_d = (d_str, disp)
        return max_d[1] if max_d else ""

    mock_eligible = [{'assignmentId': 'a1'}, {'assignmentId': 'a2'}]
    mock_arch_docs = {
        'a1': {'dateLabel': '2026/09/14'},
        'a2': {'dateLabel': '2026/09/16'}
    }
    t.assert_equal(get_latest_date(mock_eligible, mock_arch_docs), "9月16日", "應正確提取最新日期 9月16日")

    # 9. 封存作業重新命名與自動遷移測試
    def rename_assignment_in_archive(archive_data, assignment_id, new_name):
        if not archive_data or not assignment_id or not new_name:
            return archive_data, False
        modified = False
        new_assignments = []
        for a in archive_data.get('assignments', []):
            if a.get('id') == assignment_id:
                modified = True
                new_assignments.append({**a, 'name': new_name})
            else:
                new_assignments.append(a)
        new_records = []
        for r in archive_data.get('records', []):
            if r.get('assignmentId') == assignment_id:
                modified = True
                new_records.append({**r, 'assignmentName': new_name})
            else:
                new_records.append(r)
        return {**archive_data, 'assignments': new_assignments, 'records': new_records}, modified

    mock_archive = {
        'dateLabel': '2026/09/14',
        'assignments': [
            {'id': 'asg_l2', 'name': 'L2預習單', 'subjectName': '國語'}
        ],
        'records': [
            {'studentId': 's1', 'assignmentId': 'asg_l2', 'assignmentName': 'L2預習單', 'status': '已繳'},
            {'studentId': 's2', 'assignmentId': 'asg_l2', 'assignmentName': 'L2預習單', 'status': '未繳'}
        ]
    }
    updated_arch, is_mod = rename_assignment_in_archive(mock_archive, 'asg_l2', 'L3預習單')
    t.assert_equal(is_mod, True, "重新命名應標記為已修改")
    t.assert_equal(updated_arch['assignments'][0]['name'], 'L3預習單', "作業名稱應更新為 L3預習單")
    t.assert_equal(updated_arch['records'][0]['assignmentName'], 'L3預習單', "學生繳交紀錄之作業名稱應更新為 L3預習單")
    t.assert_equal(updated_arch['records'][1]['assignmentName'], 'L3預習單', "未繳學生紀錄之作業名稱應更新為 L3預習單")

    # 模擬 2026/09/14 L2預習單 遷移防止日期重複前綴
    def migrate_name(old_name, date_label):
        new_name = re.sub(r'L2\s*預習單', 'L3預習單', old_name)
        if date_label:
            new_name = re.sub(r'^2026[/-]0?9[/-]14\s*', '', new_name).strip()
        return new_name

    t.assert_equal(migrate_name('L2預習單', '2026/09/14'), 'L3預習單', "乾淨名稱不帶日期")
    t.assert_equal(migrate_name('2026/09/14 L2預習單', '2026/09/14'), 'L3預習單', "去除重複日期前綴")

    # 10. 未繳作業缺交顯示與豁免判斷 (聽考、複A卷、複B卷)
    def is_grading_missing_exempt(name):
        return bool(re.search(r'(?:聽考|複[AaＡａ]卷|複[BbＢｂ]卷)', name or ''))

    t.assert_equal(is_grading_missing_exempt('國語聽考'), True, '國語聽考應豁免缺交限制')
    t.assert_equal(is_grading_missing_exempt('聽考'), True, '聽考應豁免缺交限制')
    t.assert_equal(is_grading_missing_exempt('數學複A卷'), True, '數學複A卷應豁免缺交限制')
    t.assert_equal(is_grading_missing_exempt('複a卷'), True, '複a卷小寫應豁免缺交限制')
    t.assert_equal(is_grading_missing_exempt('期末複B卷'), True, '期末複B卷應豁免缺交限制')
    t.assert_equal(is_grading_missing_exempt('數學習作'), False, '數學習作不應豁免')
    t.assert_equal(is_grading_missing_exempt('2026/09/14 L3預習單'), False, '預習單不應豁免')

    def get_cell_render_type(is_pulled_out, status, assignment_name):
        if is_pulled_out:
            return 'pulled_out'
        is_submitted = (status == '已繳')
        is_exempt = is_grading_missing_exempt(assignment_name)
        if not is_submitted and not is_exempt:
            return 'missing_badge' # 顯示紅色長方框「缺交」
        return 'grading_buttons' # 顯示正常批改按鈕

    t.assert_equal(get_cell_render_type(True, '已繳', '數學習作'), 'pulled_out', '抽離優先顯示')
    t.assert_equal(get_cell_render_type(False, '未繳', '數學習作'), 'missing_badge', '一般作業未繳顯示缺交')
    t.assert_equal(get_cell_render_type(False, '已繳', '數學習作'), 'grading_buttons', '一般作業已繳顯示按鈕')
    t.assert_equal(get_cell_render_type(False, '未繳', '數學複A卷'), 'grading_buttons', '複A卷未繳維持顯示批改按鈕')
    t.assert_equal(get_cell_render_type(False, '未繳', '國語聽考'), 'grading_buttons', '聽考未繳維持顯示批改按鈕')
    t.assert_equal(get_cell_render_type(False, '未繳', '複B卷'), 'grading_buttons', '複B卷未繳維持顯示批改按鈕')

    # 11. 狀態與簽名解析安全防護及封存資料清理
    def derive_record_status(live_record, archive_record):
        l_status = live_record if isinstance(live_record, str) else (live_record.get('status') if isinstance(live_record, dict) else '')
        a_status = archive_record if isinstance(archive_record, str) else (archive_record.get('status') if isinstance(archive_record, dict) else '')
        if l_status == '已繳' or a_status == '已繳':
            return '已繳'
        if l_status:
            return l_status
        if a_status:
            return a_status
        return '未繳'

    def derive_record_sign(live_record, archive_record):
        l_sign = live_record if isinstance(live_record, str) else (live_record.get('signStatus') if isinstance(live_record, dict) else '')
        a_sign = archive_record if isinstance(archive_record, str) else (archive_record.get('signStatus') if isinstance(archive_record, dict) else '')
        if l_sign in ('已簽名', '已簽') or a_sign in ('已簽名', '已簽'):
            return '已簽名'
        if l_sign:
            return l_sign
        if a_sign:
            return a_sign
        return '未簽名'

    def sanitize_archive_records(records):
        result = []
        for r in (records or []):
            result.append({
                'groupId': r.get('groupId') or '',
                'groupName': r.get('groupName') or '',
                'studentId': r.get('studentId') or '',
                'studentName': r.get('studentName') or '',
                'subjectId': r.get('subjectId') or '',
                'subjectName': r.get('subjectName') or '',
                'assignmentId': r.get('assignmentId') or '',
                'assignmentName': r.get('assignmentName') or '',
                'status': r.get('status') or '未繳',
                'signStatus': r.get('signStatus') or '未簽名',
                'correctness': r.get('correctness') or '',
                'corrected': bool(r.get('corrected')),
                'remark': r.get('remark') or '',
                'pointsGiven': bool(r.get('pointsGiven')),
                'pulledOut': bool(r.get('pulledOut'))
            })
        return result

    t.assert_equal(derive_record_status({'status': '已繳'}, {'status': '未繳'}), '已繳', '活紀錄有 status 優先')
    t.assert_equal(derive_record_status({'signStatus': '已簽名'}, {'status': '已繳'}), '已繳', '活紀錄無 status 回退封存')
    t.assert_equal(derive_record_status({'status': '未繳'}, {'status': '已繳'}), '已繳', '封存紀錄已補交時不應被未繳覆蓋')
    t.assert_equal(derive_record_status({'status': '未繳'}, '已繳'), '已繳', '支援字串 fallback 解析已繳')
    t.assert_equal(derive_record_status(None, None), '未繳', '無紀錄預設未繳')
    t.assert_equal(derive_record_status({}, {}), '未繳', '空紀錄預設未繳')

    t.assert_equal(derive_record_sign({'signStatus': '已簽名'}, {'signStatus': '未簽名'}), '已簽名', '活紀錄有 signStatus 優先')
    t.assert_equal(derive_record_sign({'status': '已繳'}, {'signStatus': '已簽名'}), '已簽名', '活紀錄無 signStatus 回退封存')
    t.assert_equal(derive_record_sign({'signStatus': '未簽名'}, {'signStatus': '已簽名'}), '已簽名', '封存紀錄已補簽時不應被未簽覆蓋')
    t.assert_equal(derive_record_sign({'signStatus': '未簽名'}, '已簽名'), '已簽名', '支援字串 fallback 解析已簽')
    t.assert_equal(derive_record_sign(None, None), '未簽名', '無紀錄預設未簽名')

    sanitized = sanitize_archive_records([{'studentId': 's1', 'status': None, 'signStatus': None, 'pulledOut': True}])
    t.assert_equal(sanitized[0]['status'], '未繳', '清理後 status 不為 None/undefined')
    t.assert_equal(sanitized[0]['signStatus'], '未簽名', '清理後 signStatus 不為 None/undefined')
    t.assert_equal(sanitized[0]['correctness'], '', '清理後 correctness 為空字串')
    t.assert_equal(sanitized[0]['pulledOut'], True, '清理後正確保留 pulledOut')

    # 12. 全域統計清單（未繳、未訂正、未簽名）包含歷史聯絡簿與封存作業邏輯驗證
    def compute_global_missing(students, active_assignments, extra_past, grading_recs, records, archive_docs_map):
        all_assignments_map = {}
        for a in active_assignments:
            if a.get('name') != '聯絡簿每日任務':
                all_assignments_map[a['id']] = {'name': a['name'], 'subjectName': a.get('subjectName', ''), 'dateLabel': ''}
        for aid, info in (extra_past or {}).items():
            if aid not in all_assignments_map:
                all_assignments_map[aid] = {'name': info['name'], 'subjectName': info.get('subjectName', ''), 'dateLabel': info.get('dateLabel', '')}

        active_ass_ids = set(a['id'] for a in active_assignments)
        results = []
        for aid, info in all_assignments_map.items():
            has_grading = any(g.get('assignmentId') == aid for g in grading_recs)
            has_record = any(r.get('assignmentId') == aid for r in records)
            archive_doc = archive_docs_map.get(aid)
            if not has_grading and not has_record and (aid not in active_ass_ids) and not archive_doc:
                continue

            missing_names = []
            for s in sort_by_seat(students):
                if is_pulled_out(s, info.get('subjectName', ''), info.get('name', '')):
                    continue
                arch_rec = None
                if archive_doc and 'records' in archive_doc:
                    arch_rec = next((r for r in archive_doc['records'] if r.get('studentId') == s['id'] and r.get('assignmentId') == aid), None)
                if arch_rec and arch_rec.get('pulledOut'):
                    continue
                live_g = next((g for g in grading_recs if g.get('studentId') == s['id'] and g.get('assignmentId') == aid), None)
                correctness = live_g.get('correctness') if (live_g and live_g.get('correctness') is not None) else (arch_rec.get('correctness', '') if arch_rec else '')
                if correctness in ('遺失', '沒寫任務'):
                    continue
                rec = next((r for r in records if r.get('studentId') == s['id'] and r.get('assignmentId') == aid), None)
                status = derive_record_status(rec, arch_rec.get('status') if arch_rec else '未繳')
                if status != '已繳':
                    missing_names.append(s['name'])
            if missing_names:
                date_lbl = info.get('dateLabel', '')
                disp_name = f"{date_lbl} {info['name']}" if (date_lbl and date_lbl not in info['name']) else info['name']
                results.append({'title': disp_name, 'students': missing_names})
        return results

    def compute_global_uncorrected(students, active_assignments, extra_past, grading_recs, archive_docs_map):
        all_assignments_map = {}
        for a in active_assignments:
            if a.get('name') != '聯絡簿每日任務' and not a.get('signOnly'):
                all_assignments_map[a['id']] = {'name': a['name'], 'subjectName': a.get('subjectName', ''), 'dateLabel': ''}
        for aid, info in (extra_past or {}).items():
            if not info.get('signOnly') and aid not in all_assignments_map:
                all_assignments_map[aid] = {'name': info['name'], 'subjectName': info.get('subjectName', ''), 'dateLabel': info.get('dateLabel', '')}

        results = []
        for aid, info in all_assignments_map.items():
            archive_doc = archive_docs_map.get(aid)
            has_any = any(g.get('assignmentId') == aid for g in grading_recs) or (archive_doc and any(r.get('assignmentId') == aid and (r.get('correctness') or r.get('corrected')) for r in archive_doc.get('records', [])))
            if not has_any:
                continue

            uncorrected_names = []
            for s in sort_by_seat(students):
                if is_pulled_out(s, info.get('subjectName', ''), info.get('name', '')):
                    continue
                arch_rec = None
                if archive_doc and 'records' in archive_doc:
                    arch_rec = next((r for r in archive_doc['records'] if r.get('studentId') == s['id'] and r.get('assignmentId') == aid), None)
                if arch_rec and arch_rec.get('pulledOut'):
                    continue
                live_g = next((g for g in grading_recs if g.get('studentId') == s['id'] and g.get('assignmentId') == aid), None)
                correctness = live_g.get('correctness') if (live_g and live_g.get('correctness') is not None) else (arch_rec.get('correctness', '') if arch_rec else '')
                is_corrected = bool(live_g.get('corrected')) if (live_g and live_g.get('corrected') is not None) else bool(arch_rec.get('corrected') if arch_rec else False)
                if correctness == '有錯' and not is_corrected:
                    uncorrected_names.append(s['name'])
            if uncorrected_names:
                date_lbl = info.get('dateLabel', '')
                disp_name = f"{date_lbl} {info['name']}" if (date_lbl and date_lbl not in info['name']) else info['name']
                results.append({'title': disp_name, 'students': uncorrected_names})
        return results

    def compute_global_unsigned(students, active_assignments, extra_past, records, archive_docs_map):
        all_assignments_map = {}
        for a in active_assignments:
            if a.get('name') != '聯絡簿每日任務' and (a.get('needsSign') or a.get('signOnly')):
                all_assignments_map[a['id']] = {'name': a['name'], 'subjectName': a.get('subjectName', ''), 'signOnly': bool(a.get('signOnly')), 'dateLabel': ''}
        for aid, info in (extra_past or {}).items():
            if (info.get('needsSign') or info.get('signOnly') or info.get('name') == '聯絡簿每日任務') and aid not in all_assignments_map:
                all_assignments_map[aid] = {'name': info['name'], 'subjectName': info.get('subjectName', ''), 'signOnly': bool(info.get('signOnly')), 'dateLabel': info.get('dateLabel', '')}

        results = []
        for aid, info in all_assignments_map.items():
            arch_doc = archive_docs_map.get(aid)
            unsigned_names = []
            for s in sort_by_seat(students):
                if is_pulled_out(s, info.get('subjectName', ''), info.get('name', '')):
                    continue
                arch_rec = None
                if arch_doc and 'records' in arch_doc:
                    arch_rec = next((r for r in arch_doc['records'] if r.get('studentId') == s['id'] and r.get('assignmentId') == aid), None)
                if arch_rec and arch_rec.get('pulledOut'):
                    continue
                rec = next((r for r in records if r.get('studentId') == s['id'] and r.get('assignmentId') == aid), None)
                status = derive_record_status(rec, arch_rec.get('status') if arch_rec else '未繳')
                sign_status = derive_record_sign(rec, arch_rec.get('signStatus') if arch_rec else '未簽名')
                if info.get('name') == '聯絡簿每日任務':
                    if status != '已繳':
                        continue
                    if sign_status != '已簽名':
                        unsigned_names.append(s['name'])
                    continue
                is_exam = is_exam_assignment(info.get('name', ''))
                if not info.get('signOnly') and not is_exam and status != '已繳':
                    continue
                if sign_status != '已簽名':
                    unsigned_names.append(s['name'])
            if unsigned_names:
                date_lbl = info.get('dateLabel', '')
                disp_name = f"{date_lbl} {info['name']}" if (date_lbl and date_lbl not in info['name']) else info['name']
                results.append({'title': disp_name, 'students': unsigned_names})
        return results

    test_students = [
        {'id': 's1', 'name': '學生甲', 'seat': '1', 'pullout': None},
        {'id': 's2', 'name': '學生乙', 'seat': '2', 'pullout': None},
        {'id': 's3', 'name': '學生丙', 'seat': '3', 'pullout': {'chinese': True, 'math': False}}, # 抽離國語/聯絡簿
        {'id': 's4', 'name': '學生丁', 'seat': '4', 'pullout': None},
        {'id': 's5', 'name': '學生戊', 'seat': '5', 'pullout': None}
    ]
    past_contact_id = 'daily-聯絡簿每日任務-2026-11-03-test'
    test_extra_past = {
        past_contact_id: {
            'name': '聯絡簿每日任務',
            'dateLabel': '2026/11/03',
            'subjectName': '聯絡簿',
            'needsSign': True,
            'signOnly': False
        }
    }
    test_archive_doc = {
        'id': 'arc_1103',
        'dateLabel': '2026/11/03',
        'assignments': [{'id': past_contact_id, 'name': '聯絡簿每日任務', 'subjectName': '聯絡簿', 'needsSign': True}],
        'records': [
            {'studentId': 's1', 'assignmentId': past_contact_id, 'status': '已繳', 'signStatus': '未簽名', 'correctness': '有錯', 'corrected': False},
            {'studentId': 's2', 'assignmentId': past_contact_id, 'status': '未繳', 'signStatus': '未簽名', 'correctness': '', 'corrected': False},
            {'studentId': 's3', 'assignmentId': past_contact_id, 'status': '未繳', 'signStatus': '未簽名', 'correctness': '', 'corrected': False, 'pulledOut': True},
            {'studentId': 's4', 'assignmentId': past_contact_id, 'status': '已繳', 'signStatus': '已簽名', 'correctness': '全對', 'corrected': False},
            {'studentId': 's5', 'assignmentId': past_contact_id, 'status': '已繳', 'signStatus': '已簽名', 'correctness': '沒寫任務', 'corrected': False}
        ]
    }
    test_archive_docs_map = {
        past_contact_id: test_archive_doc,
        'arc_1103': test_archive_doc
    }
    test_active_assignments = [
        {'id': 'daily-current', 'name': '聯絡簿每日任務', 'subjectName': '聯絡簿', 'needsSign': True}
    ]

    # 驗證未繳清單包含封存聯絡簿且排除抽離與沒寫任務
    missing_res = compute_global_missing(test_students, test_active_assignments, test_extra_past, [], [], test_archive_docs_map)
    t.assert_equal(len(missing_res), 1, "未繳清單應有1個作業區塊")
    t.assert_equal(missing_res[0]['title'], '2026/11/03 聯絡簿每日任務', "作業名稱應含日期標記")
    t.assert_equal(missing_res[0]['students'], ['學生乙'], "僅學生乙未繳（學生丙抽離，學生戊沒寫任務）")

    # 驗證未訂正清單包含封存聯絡簿有錯未訂正學生
    uncorrected_res = compute_global_uncorrected(test_students, test_active_assignments, test_extra_past, [], test_archive_docs_map)
    t.assert_equal(len(uncorrected_res), 1, "未訂正清單應有1個作業區塊")
    t.assert_equal(uncorrected_res[0]['title'], '2026/11/03 聯絡簿每日任務', "未訂正作業名稱應含日期標記")
    t.assert_equal(uncorrected_res[0]['students'], ['學生甲'], "學生甲有錯且未訂正")

    # 驗證未簽名清單包含封存聯絡簿已繳未簽學生
    unsigned_res = compute_global_unsigned(test_students, test_active_assignments, test_extra_past, [], test_archive_docs_map)
    t.assert_equal(len(unsigned_res), 1, "未簽名清單應有1個作業區塊")
    t.assert_equal(unsigned_res[0]['title'], '2026/11/03 聯絡簿每日任務', "未簽名作業名稱應含日期標記")
    t.assert_equal(unsigned_res[0]['students'], ['學生甲'], "學生甲已繳但未簽名（學生乙未繳不列入未簽名）")

    # 驗證補交後未繳清單更新
    live_records_after_makeup = [{'studentId': 's2', 'assignmentId': past_contact_id, 'status': '已繳', 'signStatus': '未簽名'}]
    missing_after = compute_global_missing(test_students, test_active_assignments, test_extra_past, [], live_records_after_makeup, test_archive_docs_map)
    t.assert_equal(len(missing_after), 0, "學生乙補交後未繳清單應為空")

    # 驗證補訂正後未訂正清單更新
    live_grading_after_corrected = [{'studentId': 's1', 'assignmentId': past_contact_id, 'correctness': '有錯', 'corrected': True}]
    uncorrected_after = compute_global_uncorrected(test_students, test_active_assignments, test_extra_past, live_grading_after_corrected, test_archive_docs_map)
    t.assert_equal(len(uncorrected_after), 0, "學生甲訂正後未訂正清單應為空")

    # 驗證補簽後未簽名清單更新
    live_records_after_sign = [{'studentId': 's1', 'assignmentId': past_contact_id, 'status': '已繳', 'signStatus': '已簽名'}]
    unsigned_after = compute_global_unsigned(test_students, test_active_assignments, test_extra_past, live_records_after_sign, test_archive_docs_map)
    t.assert_equal(len(unsigned_after), 0, "學生甲補簽後未簽名清單應為空")

    # 13. 補繳／補簽／請假備註標準化與合併測試
    LEAVE_RE = re.compile(r'(?:請假|病假|事假|公假|喪假)')
    MAKEUP_SUB_RE = re.compile(r'(?:已補繳|已補交|補繳|補交|狀態改已繳)')
    MAKEUP_SGN_RE = re.compile(r'(?:已補簽|補簽)')

    def normalize_seg(seg):
        s = (seg or '').strip()
        if not s:
            return ''
        if s in ('已補交', '補交'):
            return '已補繳'
        if s.startswith('已補交（') or s.startswith('已補交('):
            return '已補繳' + s[3:]
        if s.startswith('補交（') or s.startswith('補交('):
            return '已補繳' + s[2:]
        if s == '補簽':
            return '已補簽'
        if s.startswith('補簽（') or s.startswith('補簽('):
            return '已補簽' + s[2:]
        return s

    def split_segs(rmk):
        if not rmk:
            return []
        s_str = str(rmk)
        out = []
        buf = []
        depth = 0
        for i, ch in enumerate(s_str):
            if ch in ('(', '（'):
                depth += 1
                buf.append(ch)
            elif ch in (')', '）'):
                if depth > 0:
                    depth -= 1
                buf.append(ch)
            elif depth == 0 and ch == '/':
                prev_ch = s_str[i - 1] if i > 0 else ''
                next_ch = s_str[i + 1] if i + 1 < len(s_str) else ''
                if prev_ch.isdigit() and next_ch.isdigit():
                    buf.append(ch)
                else:
                    norm = normalize_seg(''.join(buf))
                    if norm:
                        out.append(norm)
                    buf = []
            else:
                buf.append(ch)
        last = normalize_seg(''.join(buf))
        if last:
            out.append(last)
        return out

    def append_makeup_submit(rmk, ts):
        segs = [s for s in split_segs(rmk) if not MAKEUP_SUB_RE.search(s)]
        tag = f"已補繳（{ts}）" if ts else "已補繳"
        sign_idx = next((i for i, s in enumerate(segs) if MAKEUP_SGN_RE.search(s)), -1)
        if sign_idx != -1:
            segs.insert(sign_idx, tag)
        else:
            segs.append(tag)
        return " / ".join(segs)

    def append_makeup_sign(rmk, ts):
        segs = [s for s in split_segs(rmk) if not MAKEUP_SGN_RE.search(s)]
        segs.append(f"已補簽（{ts}）" if ts else "已補簽")
        return " / ".join(segs)

    def toggle_leave_remark(rmk, should_leave):
        segs = [s for s in split_segs(rmk) if not LEAVE_RE.search(s)]
        if should_leave:
            segs.insert(0, '請假')
        return " / ".join(segs)

    r_txt = append_makeup_submit('', '2026/11/03 16:00:00')
    t.assert_equal(r_txt, '已補繳（2026/11/03 16:00:00）', '補交應產生已補繳文字')
    r_txt = append_makeup_sign(r_txt, '2026/11/03 16:05:00')
    t.assert_equal(r_txt, '已補繳（2026/11/03 16:00:00） / 已補簽（2026/11/03 16:05:00）', '補簽應同時保留已補繳')
    r_txt = toggle_leave_remark(r_txt, True)
    t.assert_equal(r_txt, '請假 / 已補繳（2026/11/03 16:00:00） / 已補簽（2026/11/03 16:05:00）', '標記請假應同時保留已補繳與已補簽')
    t.assert_equal(normalize_seg('已補交（11/02）'), '已補繳（11/02）', '舊版已補交自動轉為已補繳')
    t.assert_equal(normalize_seg('補簽（11/02）'), '已補簽（11/02）', '舊版補簽自動轉為已補簽')

    # 14. 期中／期末補繳與請假（另外算）分流驗證
    def classify_student_records(records_list):
        reg_makeup, reg_missing, leave_makeup, leave_missing = [], [], [], []
        for rec in records_list:
            st_val = rec.get('status', '未繳')
            rmk = rec.get('remark', '')
            leave = bool(rec.get('isLeave') or LEAVE_RE.search(rmk))
            makeup = st_val == '已繳' and bool(rec.get('isMakeup') or MAKEUP_SUB_RE.search(rmk))
            if leave:
                if st_val == '已繳':
                    leave_makeup.append(rec['name'])
                else:
                    leave_missing.append(rec['name'])
            elif st_val == '已繳' and makeup:
                reg_makeup.append(rec['name'])
            elif st_val != '已繳':
                reg_missing.append(rec['name'])
        return {
            'regularMakeup': reg_makeup,
            'regularMissing': reg_missing,
            'leaveMakeup': leave_makeup,
            'leaveMissing': leave_missing
        }

    classified = classify_student_records([
        {'name': '9/25 數習', 'status': '已繳', 'remark': '已補繳（9/26）', 'isMakeup': True, 'isLeave': False},
        {'name': '10/02 國習', 'status': '未繳', 'remark': '', 'isMakeup': False, 'isLeave': False},
        {'name': '10/15 聯絡簿', 'status': '已繳', 'remark': '請假 / 已補繳（10/16）', 'isMakeup': True, 'isLeave': True},
        {'name': '10/20 數卷', 'status': '未繳', 'remark': '請假', 'isMakeup': False, 'isLeave': True},
        {'name': '10/22 國卷', 'status': '已繳', 'remark': '', 'isMakeup': False, 'isLeave': False}
    ])
    t.assert_equal(classified['regularMakeup'], ['9/25 數習'], '一般補繳僅統計非請假補繳')
    t.assert_equal(classified['regularMissing'], ['10/02 國習'], '一般未繳僅統計非請假未繳')
    t.assert_equal(classified['leaveMakeup'], ['10/15 聯絡簿'], '因請假已補繳歸入另外算')
    t.assert_equal(classified['leaveMissing'], ['10/20 數卷'], '因請假未繳歸入另外算')

    # 15. 專案原始碼結構與雙軌一致性靜態檢查 (index.html + src/*)
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    index_text = (root / 'index.html').read_text(encoding='utf-8')
    rules_text = (root / 'src' / 'domain' / 'rules.js').read_text(encoding='utf-8')
    grading_text = (root / 'src' / 'ui' / 'gradingTab.js').read_text(encoding='utf-8')
    app_text = (root / 'src' / 'app.js').read_text(encoding='utf-8')

    required_symbols = [
        'computeGlobalPopupLists',
        'computeMakeupAndLeaveStats',
        'formatMakeupAndLeaveReport',
        'appendMakeupSubmitRemark',
        'appendMakeupSignRemark',
        'toggleLeaveRemark',
        'deriveRecordRemark'
    ]
    for sym in required_symbols:
        t.assert_equal(sym in rules_text, True, f"src/domain/rules.js 應包含 {sym}")
        t.assert_equal(sym in index_text, True, f"index.html 應同步包含 {sym}")

    required_ui_ids = [
        'globalMakeupStatsBtn',
        'recordsMakeupStatsBtn',
        'markTodayLeaveBtn',
        'contactLeaveBtn',
        'makeupStatsModal',
        'todayLeaveModal'
    ]
    combined_src_ui = grading_text + "\n" + app_text
    for uid in required_ui_ids:
        t.assert_equal(uid in index_text, True, f"index.html 應包含 UI 元件 #{uid}")
        t.assert_equal(uid in combined_src_ui, True, f"src/ 模組應包含 UI 元件 #{uid}")

    # 驗證按鈕文字、樣式與彈窗文案已依需求更新
    for txt in ('補繳次數統計', '期中／期末 作業補繳與未繳統計', 'btn-leave', 'btn-stats', 'subjectGroups', 'resolveStatsSubjectName'):
        t.assert_equal(txt in index_text, True, f"index.html 應包含更新文案/樣式 {txt}")
    t.assert_equal('subjectGroups' in rules_text and 'subjectGroups' in grading_text, True, "src/ 應支援依科目排列統計明細")
    t.assert_equal('#fbf1e6' in index_text and '#fbf7ee' in index_text and '#5e4a1a' in index_text, True, "按鈕應套用淡色底與同色系深色字")
    t.assert_equal('border:2.5px dashed var(--line)' in index_text and 'border:2.5px dashed var(--line)' in app_text, True, "今日請假學生框應為粗虛線且無底色")
    t.assert_equal('.leave-btn.active { background: #d5c38d;' in index_text, True, "✓請假底色應填滿邊框色 #d5c38d")
    t.assert_equal('.leave-tag { display: inline-block; padding: 1px 7px; border-radius: 10px; background: #fbf7ee; border: 1px solid #d5c38d; color: #5e4a1a; font-size: 0.72em; white-space: nowrap;' in index_text, True, "請假標籤不應為粗體")
    t.assert_equal('.leave-btn.active { background: #d5c38d; border-color: #d5c38d; color: #5e4a1a; }' in index_text, True, "✓請假按鈕不應為粗體")
    t.assert_equal('明細 / 標記請假' not in index_text, True, "index.html 應已將明細/標記請假簡化為明細")
    t.assert_equal('isAllPurpleSubject' in rules_text or 'aAllPurple' in rules_text, True, "應支援全紫色科目排到最後之排序")
    t.assert_equal('展開學生明細即可一鍵標記或取消「請假」' not in index_text, True, "index.html 應已移除提示文字")
    t.assert_equal('展開學生明細即可一鍵標記或取消「請假」' not in grading_text, True, "gradingTab.js 應已移除提示文字")

    print(f"✓ 恭喜！全數 {t.passes} 項領域業務與結構測試斷言通過！")

if __name__ == '__main__':
    run_tests()

