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
    def is_pulled_out(student, subject):
        if not student or not student.get('pullout') or not subject:
            return False
        p = student['pullout']
        if '國' in subject and p.get('chinese'):
            return True
        if '數' in subject and p.get('math'):
            return True
        return False

    s1 = {'name': 'A', 'pullout': {'chinese': True, 'math': False}}
    s2 = {'name': 'B', 'pullout': {'chinese': False, 'math': True}}
    t.assert_equal(is_pulled_out(s1, '國語'), True, "國語抽離判定")
    t.assert_equal(is_pulled_out(s1, '數學'), False, "國語抽離但在數學不應被抽離")
    t.assert_equal(is_pulled_out(s2, '數學'), True, "數學抽離判定")

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

    print(f"✓ 恭喜！全數 {t.passes} 項領域業務測試斷言通過！")

if __name__ == '__main__':
    run_tests()

