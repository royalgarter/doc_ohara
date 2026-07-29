# Đề xuất chuyển hướng OHARA sang lĩnh vực Y tế

## 1. OHARA đã đạt được gì

OHARA (bài nộp RIVF 2026) là framework Space-Time Graph cho truy xuất và trực quan hóa cơ sở tri thức, đánh giá trên QASPER (200 bài báo học thuật) và MultiHop-RAG (609 bài báo tin tức). Kết quả chính:

- Nền tảng Space-Time Graph: bộ 5 $G=(V,E,\tau,\delta,\sigma)$ hợp nhất cấu trúc phân cấp tài liệu, suy giảm thời gian, liên kết thực thể xuyên tài liệu. 7 loại quan hệ (`has_child`, `next_sibling`, `belongs_to`, `mentions`, `related_to`, `similar_to`, `toc_ref`).
- Chấm điểm suy giảm thời gian: 4 lớp suy giảm (evergreen, scholarly, current, ephemeral) theo hàm mũ $w \cdot e^{-\lambda \Delta t}$, có cơ chế bảo vệ 5 lớp chống phạt quá mức nội dung cũ nhưng vẫn liên quan.
- Engine truy xuất lai 8 pha: kết hợp BM25, vector dày (gemini-embedding), overlap ontology SUMO, duyệt đa bước, pivot thực thể, tín hiệu cấu trúc, qua fusion có trọng số.
- Đầu ra phân tầng, có điều kiện xác nhận chéo: 3 tầng Principal, Integrity, Explorer. Tầng Principal yêu cầu tối thiểu 2 nguồn tín hiệu độc lập, ngưỡng điểm, bằng chứng xuyên tài liệu. Tầng này từ chối trả lời 45.6% câu hỏi không có đáp án (so với 0.0% của cutoff top-k thường), vẫn giữ hit rate 91.5% trên câu hỏi có đáp án. Nghĩa là hệ thống biết khi nào không nên trả lời.
- Trực quan hóa 3D Space-Time: trục Z là thời gian, mặt phẳng cực là ontology (SUMO), đĩa xuyên tâm là cấu trúc tài liệu. Render tới 12,323 node, scaling gần tuyến tính (batching InstancedMesh).
- Chi phí/quy mô: khoảng 12 đô la cho 1000 tài liệu để ingest và dựng graph ngữ nghĩa đầy đủ. Cache theo content-hash giúp re-ingest idempotent, nhưng chỉ ở mức chunk, chưa ở mức edge (hạn chế đã biết).
- Hạn chế đã ghi nhận thẳng thắn: phụ thuộc backend Gemini, chỉ chạy tốt với văn bản tiếng Anh sạch (chưa đánh giá OCR/input nhiễu), decay scoring giúp task dạng corpus nhưng không giúp task cần thứ tự sự kiện, hình ảnh rối khi vượt khoảng 50 đĩa tài liệu.

Đóng góp cốt lõi của OHARA không phải "ranking tốt hơn". OHARA chỉ ngang bằng (không vượt) dense-vector retrieval thuần trên Hits@10. Đóng góp thực sự là khả năng kiểm chứng (auditability): provenance cấu trúc, thời gian, ontology được nhúng ngay trong graph, cộng với cơ chế gating biết từ chối thay vì bịa (hallucinate) khi bằng chứng yếu.

## 2. Phần nào của OHARA phù hợp với Y tế

Ý tưởng gốc của thầy (6 agent lâm sàng: Radiology, Pathology, Oncology, ICU, Pharmacy, Treatment Recommendation, dùng RAG + Medical KG + Tool Calling để thành CDSS đầy đủ) có quy mô luận án/sản phẩm, không phải một bài báo. Hướng draft cụ thể hơn (Minkowski spacetime graph + Med-VLM + MMed-RAG + RL) đúng về kiến trúc nhưng gộp 4 bài toán nghiên cứu riêng biệt (causal graph, đa phương thức, retrieval, RL) vào một sản phẩm.

Những phần OHARA có sẵn và fit trực tiếp vào bài toán Y tế:

- $\tau$ (ánh xạ thời gian) và $\delta$ (lớp suy giảm) ứng với vị trí worldline bệnh nhân và tốc độ tiến triển bệnh. Có thể thay "vận tốc β" kiểu Minkowski bằng cơ chế decay-class có sẵn, không cần xây mới.
- 7 loại quan hệ trong $R$ là nền để mở rộng thêm quan hệ nhân quả, cùng pattern gõ edge đã dùng cho `similar_to`, `related_to`.
- Ontology SUMO đóng đúng vai trò "tag-expansion candidate retrieval" mà UMLS/RadLex cần cho Y tế, chỉ cần đổi nguồn ontology.
- 3 tầng Principal, Integrity, Explorer cùng cơ chế gating xác nhận chéo tái dùng nguyên trạng, không cần thiết kế mới. Đây chính là ràng buộc FDA "Retrieval-Only, provenance-pointer, không tự chẩn đoán" mà draft của thầy yêu cầu. Con số 45.6% từ chối trên câu hỏi không có đáp án đúng là hành vi FDA SaMD Class II muốn có.
- Engine fusion 8 pha (BM25, vector, ontology, entity, structural) tái dùng không đổi cho truy xuất văn bản EHR như clinical notes, discharge summaries.
- Trực quan hóa 3D Space-Time đổi trục Z thành timeline bệnh nhân thực, đĩa xuyên tâm thành cấu trúc encounter/note theo từng bệnh nhân thay vì theo tài liệu.

Những phần là việc mới thật sự, không tái dùng được:

- Phân loại edge nhân quả (time-like vs space-like). Có thể bắt đầu bằng heuristic rule-based (thứ tự thời gian cộng prior nhân quả theo mã bệnh, ví dụ thuốc dẫn tới thay đổi chỉ số xét nghiệm trong cửa sổ thời gian lâm sàng) thay vì công thức Minkowski đầy đủ. Nên hoãn phần hình thức hóa vật lý trừ khi reviewer yêu cầu cụ thể, vì nó tăng tính chặt chẽ trình bày nhưng chưa chắc tăng độ chính xác retrieval.
- Tích hợp UMLS/RadLex cần license UMLS (tài khoản UTS, ký thỏa thuận, thời gian chờ không nhỏ) trước khi làm bất kỳ việc mapping ontology nào. Đây là dependency cần giải quyết trước tiên.
- Truy cập dữ liệu EHR/PACS hiện chưa có dataset trong tay. Hướng khả thi là dùng MIMIC-IV (EHR có cấu trúc, gần chuẩn FHIR) làm corpus v1, vì public và quy trình credentialing đã quen thuộc (khóa CITI training của PhysioNet). MIMIC-CXR (ảnh) hoãn sang phase 2.
- Med-VLM alignment (MedCLIP, DCFormer, Med3DVLM) là modal hoàn toàn mới, không overlap với pipeline OHARA hiện tại. Loại khỏi phạm vi v1.
- RL cho trigger retrieval (Med-RwR) là thành phần mới, OHARA hiện chưa có RL nào. Loại khỏi phạm vi v1.

## 3. Các bước chuyển đổi thành ứng dụng Y tế

1. Ingest note/timeline lâm sàng MIMIC-IV vào cấu trúc Space-Time Graph hiện có. Tái dùng pipeline ingest, chỉ đổi tagger SUMO thành UMLS concept extractor.
2. Thêm 2 loại edge mới vào $R$: `precedes_causally` (time-like, nhân quả) và `co_occurs_independent` (space-like, độc lập), dùng rule-based prior thời gian/mã bệnh, chưa cần metric Minkowski đầy đủ.
3. Tái dùng engine retrieval 8 pha không đổi cho truy xuất note/timeline bệnh nhân.
4. Tái dùng 3 tầng Principal/Integrity/Explorer không đổi làm lớp đầu ra "Retrieval-Only + provenance" theo FDA. Đây là phần draft của thầy yêu cầu mà OHARA đã giải quyết sẵn.
5. Đánh giá xem gõ edge nhân quả có giảm đo được việc truy xuất chẩn đoán cũ hoặc đã bị bác bỏ (ý tưởng "rebuttal edge") so với cách chỉ dùng temporal-decay hiện tại hay không.
6. Sau khi có kết quả v1, mới cân nhắc mở rộng: căn chỉnh ảnh Med-VLM, ingest DICOM/PACS, hình thức hóa hình học Minkowski đầy đủ, RL tối ưu trigger retrieval, phân rã đa agent (Radiology/Pathology/Oncology/ICU/Pharmacy). Đây nên là milestone bài báo/luận án riêng, không gộp vào v1.

## 4. Câu hỏi cần chốt trước khi bắt đầu

- Thời gian chờ license UMLS có kịp deadline nộp bài không.
- Thầy có cần khung Minkowski/tương đối cụ thể vì lý do tường thuật/tính mới, hay causal-DAG với conflict-resolution đơn giản hơn cũng chấp nhận được. Điều này quyết định formalism toán học có đáng công viết hay không.
- Xác nhận việc xin quyền truy cập MIMIC-IV (PhysioNet credentialing) có hoàn tất kịp thời gian không.
