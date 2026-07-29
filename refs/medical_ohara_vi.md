# Đề xuất chuyển hướng OHARA sang lĩnh vực Y tế

## 1. OHARA đã đạt được gì

OHARA là một framework Space-Time Graph phục vụ truy xuất và trực quan hóa cơ sở tri thức, đã được đánh giá thực nghiệm trên hai bộ dữ liệu: QASPER (200 bài báo học thuật) và MultiHop-RAG (609 bài báo tin tức). Mã nguồn và tài liệu đầy đủ được công bố tại: https://github.com/royalgarter/doc_ohara

**Kết quả chính:**

- Nền tảng Space-Time Graph: được xây dựng trên bộ 5 thành phần $G=(V,E,\tau,\delta,\sigma)$, hợp nhất cấu trúc phân cấp tài liệu, cơ chế suy giảm theo thời gian và liên kết thực thể xuyên tài liệu, gồm 7 loại quan hệ (`has_child`, `next_sibling`, `belongs_to`, `mentions`, `related_to`, `similar_to`, `toc_ref`).
- Cơ chế chấm điểm suy giảm thời gian: gồm 4 lớp suy giảm (evergreen, scholarly, current, ephemeral) theo hàm mũ $w \cdot e^{-\lambda \Delta t}$, kèm cơ chế bảo vệ 5 lớp nhằm tránh phạt quá mức đối với nội dung cũ nhưng vẫn còn giá trị liên quan.
- Engine truy xuất lai 8 pha: kết hợp BM25, vector dày (gemini-embedding), overlap ontology SUMO, duyệt đa bước, liên kết thực thể xuyên tài liệu và tín hiệu cấu trúc, thông qua cơ chế fusion có trọng số.
- Đầu ra phân tầng với điều kiện xác nhận chéo: gồm 3 tầng Principal, Integrity, Explorer. Tầng Principal yêu cầu tối thiểu 2 nguồn tín hiệu độc lập cùng ngưỡng điểm và bằng chứng xuyên tài liệu. Tầng này từ chối trả lời đối với 45,6% câu hỏi không có đáp án xác định (so với 0,0% khi áp dụng cutoff top-k thông thường), trong khi vẫn duy trì tỷ lệ khớp đúng (hit rate) 91,5% trên các câu hỏi có đáp án — cho thấy hệ thống có khả năng nhận biết thời điểm không nên đưa ra câu trả lời.
- Trực quan hóa 3D Space-Time: trục Z biểu diễn thời gian, mặt phẳng cực biểu diễn ontology (SUMO), các đĩa xuyên tâm biểu diễn cấu trúc tài liệu. Hệ thống có khả năng render đến 12.323 node với mức độ mở rộng gần tuyến tính (nhờ kỹ thuật batching InstancedMesh).
- Chi phí và khả năng mở rộng: khoảng 12 đô la Mỹ cho mỗi 1.000 tài liệu để thực hiện ingest và xây dựng đầy đủ đồ thị ngữ nghĩa. Cơ chế cache theo content-hash cho phép tái ingest theo nguyên tắc idempotent, tuy nhiên hiện mới áp dụng ở cấp độ chunk, chưa mở rộng đến cấp độ edge — đây là một hạn chế đã được ghi nhận.
- Các hạn chế được nhìn nhận một cách khách quan: hệ thống phụ thuộc vào backend Gemini, hoạt động tốt nhất với văn bản tiếng Anh có chất lượng sạch (chưa được đánh giá trên dữ liệu OCR hoặc dữ liệu nhiễu); cơ chế chấm điểm suy giảm thời gian phù hợp với các tác vụ ở cấp độ corpus nhưng chưa hỗ trợ tốt các tác vụ đòi hỏi thứ tự sự kiện; giao diện trực quan hóa có thể trở nên khó quan sát khi vượt quá khoảng 50 đĩa tài liệu.

Đóng góp cốt lõi của OHARA không nằm ở việc cải thiện chỉ số xếp hạng (ranking) — trên chỉ số Hits@10, OHARA đạt mức hiệu suất tương đương với phương pháp dense-vector retrieval thuần túy. Giá trị đóng góp chính của framework nằm ở khả năng kiểm chứng (auditability): thông tin về nguồn gốc cấu trúc, thời gian và ontology được nhúng trực tiếp trong đồ thị tri thức, kết hợp với cơ chế gating cho phép hệ thống chủ động từ chối trả lời thay vì tạo ra thông tin sai lệch (hallucination) khi bằng chứng thu thập được không đủ vững chắc.

## 2. Phần nào của OHARA phù hợp với Y tế

Ý tưởng gốc: (6 agent lâm sàng: Radiology, Pathology, Oncology, ICU, Pharmacy, Treatment Recommendation, dùng RAG + Medical KG + Tool Calling để thành CDSS đầy đủ) có quy mô luận án/sản phẩm, không phải một bài báo. 

Ý tưởng Draft: (Minkowski spacetime graph + Med-VLM + MMed-RAG + RL) đúng về kiến trúc nhưng gộp 4 bài toán nghiên cứu riêng biệt (causal graph, đa phương thức, retrieval, RL) vào một sản phẩm.

Những phần OHARA có sẵn và fit trực tiếp vào bài toán Y tế:

- $\tau$ (ánh xạ thời gian) và $\delta$ (lớp suy giảm) ứng với vị trí worldline bệnh nhân và tốc độ tiến triển bệnh. Có thể thay "vận tốc β" kiểu Minkowski bằng cơ chế decay-class có sẵn, không cần xây mới.
- 7 loại quan hệ trong $R$ là nền để mở rộng thêm quan hệ nhân quả, cùng pattern gõ edge đã dùng cho `similar_to`, `related_to`.
- Ontology SUMO đóng đúng vai trò "tag-expansion candidate retrieval" mà UMLS/RadLex cần cho Y tế, chỉ cần đổi nguồn ontology.
- 3 tầng Principal, Integrity, Explorer cùng cơ chế gating xác nhận chéo tái dùng nguyên trạng, không cần thiết kế mới. Đây chính là ràng buộc FDA "Retrieval-Only, provenance-pointer, không tự chẩn đoán" mà draft của thầy yêu cầu. Con số 45.6% từ chối trên câu hỏi không có đáp án đúng là hành vi FDA SaMD Class II muốn có.
- Engine fusion 8 pha (BM25, vector, ontology, entity, structural) tái dùng không đổi cho truy xuất văn bản EHR như clinical notes, discharge summaries.
- Trực quan hóa 3D Space-Time đổi trục Z thành timeline bệnh nhân thực, đĩa xuyên tâm thành cấu trúc encounter/note theo từng bệnh nhân thay vì theo tài liệu.

Những phần là việc mới cần triển khai:

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

## 4. Benchmark ban đầu: OHARA so với framework RAG khác

Nhóm nghiên cứu đã tiến hành thực nghiệm đối chứng với LightRAG (Guo et al., 2024), cấu hình lại để sử dụng cùng bộ model Gemini với OHARA (`gemini-2.5-flash-lite`, `gemini-embedding-2` 768 chiều), nhằm cô lập biến số kiến trúc, loại trừ ảnh hưởng của lựa chọn model nền. Hai hệ thống được ingest và truy vấn trên cùng hai bộ dữ liệu đã dùng để đánh giá OHARA: QASPER (200 bài báo học thuật, 150 câu hỏi) và MultiHop-RAG (608/609 tài liệu — một tài liệu bị bộ lọc an toàn nội dung của Gemini chặn vĩnh viễn nên được loại khỏi tập dữ liệu, 500 câu hỏi). Mã nguồn, nhật ký thực nghiệm và công cụ chấm điểm được lưu trữ tại `baseline/lightrag/`.

**Kết quả:**

| Bộ dữ liệu | OHARA (Hits@10) | LightRAG (Gemini) | Ghi chú |
|---|---|---|---|
| QASPER (150 câu) | 30,0–33,3% | 34,7% (52/150) | Hai hệ thống đạt mức tương đương, dưới điều kiện chấm điểm khác nhau |
| MultiHop-RAG (500 câu) | 96,5–98,4% | 68,0% (340/500) | OHARA vượt trội rõ rệt |

**Về tính tương thích của phép so sánh:** LightRAG ở chế độ hybrid trả về một khối ngữ cảnh không xếp hạng và không giới hạn kích thước (riêng QASPER: khoảng 130–140 nghìn ký tự, gộp chung entity, relation và chunk). Do không có thứ tự xếp hạng, các chỉ số MRR, MAP và Gold-Recall không thể tính được cho LightRAG. Vì vậy phương pháp chấm điểm buộc phải điều chỉnh cho phù hợp với từng bộ dữ liệu:
- QASPER: tính là khớp (hit) nếu đoạn bằng chứng chuẩn (gold evidence) trùng khớp với nội dung trong khối ngữ cảnh — không giới hạn kích thước ngữ cảnh, tức là điều kiện thuận lợi hơn so với ràng buộc top-10 mà OHARA phải tuân thủ.
- MultiHop-RAG: do khối ngữ cảnh của LightRAG không gắn kèm định danh tài liệu, không thể áp dụng phương pháp chấm điểm cấp tài liệu (document-level) như với OHARA; thay vào đó, nhóm nghiên cứu sử dụng tiêu chí "chuỗi ký tự đáp án có xuất hiện trong ngữ cảnh truy xuất hay không" làm chỉ số recall tham chiếu — đây cũng là điều kiện chấm điểm lỏng hơn so với phương pháp khớp cấp tài liệu.

**Nhận định kết quả:**

1. Trên bộ dữ liệu QASPER, OHARA đạt hiệu suất tương đương LightRAG (30,0–33,3% so với 34,7%) dù bị giới hạn nghiêm ngặt trong top-10 kết quả, trong khi LightRAG được hưởng lợi thế ngữ cảnh không giới hạn. Kết quả này cho thấy hiệu quả sử dụng ngữ cảnh của OHARA trong bài toán hỏi đáp đơn tài liệu.
2. Trên bộ dữ liệu MultiHop-RAG — bài toán đòi hỏi suy luận đa bước, xuyên tài liệu, đúng với định hướng thiết kế của kiến trúc Space-Time Graph — OHARA thể hiện ưu thế rõ rệt: 96,5–98,4% so với 68,0%, dù tiêu chí chấm điểm áp dụng cho LightRAG vốn dĩ lỏng hơn. Kết quả này là minh chứng thực nghiệm cho giá trị của cơ chế liên kết thực thể xuyên tài liệu (cross-document pivot) và cơ chế xác nhận chéo (corroboration gating) trong OHARA đối với lớp bài toán mà phương pháp truy xuất không xếp hạng của LightRAG còn hạn chế.
3. Tổng kết: OHARA đạt hiệu suất tương đương baseline mạnh nhất trên bài toán đơn giản, và vượt trội rõ rệt trên bài toán phức tạp — phù hợp với định hướng giá trị cốt lõi của framework. Đây là kết quả thực nghiệm ban đầu mang tính định hướng (directional), chưa phải là phép so sánh xếp hạng theo cùng một phương pháp chấm điểm tuyệt đối; điều kiện đo lường cần được trình bày minh bạch trong báo cáo để đảm bảo tính khoa học của kết quả.

**Định hướng tiếp theo:** HippoRAG (Gutierrez et al., 2024) đã được chuẩn bị khung triển khai (`baseline/hipporag/`, gồm README và `.env.example`), sẵn sàng để tiến hành thực nghiệm. Về mặt kiến trúc, HippoRAG sử dụng thuật toán Personalized PageRank trên đồ thị tri thức, được thiết kế chuyên biệt cho bài toán truy vấn đa bước, do đó dự kiến sẽ là baseline có tính cạnh tranh cao hơn LightRAG trên bộ dữ liệu MultiHop-RAG. Việc bổ sung HippoRAG vào phép so sánh sẽ củng cố thêm giá trị của kết quả đã đạt được. Cùng với việc xây dựng công cụ đánh giá có xếp hạng (rank-aware) cho LightRAG nhằm so sánh công bằng hơn trên các chỉ số MRR/MAP, đây là các hướng mở rộng tự nhiên cho giai đoạn nghiên cứu tiếp theo, không nằm trong phạm vi bắt buộc của phiên bản v1.

## 5. Agentic AI cho nền tảng (phase 2, chưa đưa vào v1)

OHARA đã có sẵn `queryAgent` (`src/retrieval.js`): mỗi vòng lặp, Gemini đọc query + kết quả tìm được + lịch sử tool đã dùng, chọn 1 trong `bm25 | entity_pivot | cross_doc | structural | done` (`prompts/agent_strategy.md`), dừng khi đủ bằng chứng hoặc đạt `OHARA_AGENT_MAX_ITER`. Đây là nền để mở rộng thành Agentic AI cho platform Y tế, theo 4 hướng, tăng dần độ phức tạp:

**5.1 Agent chỉ chọn chiến lược truy xuất (retrieval-only safety layer)**

Agent không tự sinh chẩn đoán hay khuyến nghị điều trị, chỉ quyết định nên tra nguồn bằng chứng nào (BM25 note, entity pivot theo mã bệnh, cross-doc timeline, structural traversal theo encounter). Đầu ra vẫn đi qua gating Principal/Integrity/Explorer trước khi tới người dùng. Đây là mở rộng an toàn nhất, giữ đúng ràng buộc FDA "Retrieval-Only", gần như không đổi kiến trúc so với `queryAgent` hiện tại, chỉ đổi tool registry và prompt sang thuật ngữ lâm sàng.

**5.2 Agent theo vai trò lâm sàng (role-specific agent)**

Mỗi vai trò (Radiology, Pathology, Oncology, ICU, Pharmacy, Treatment Recommendation) là một instance của cùng kiến trúc `queryAgent`, khác nhau ở tool registry và prompt:
- Radiology agent: tool tra cứu báo cáo hình ảnh + mở rộng RadLex.
- Pharmacy agent: tool kiểm tra tương tác thuốc + tra liều theo guideline.
- ICU agent: tool tra timeline sinh hiệu + ngưỡng cảnh báo.

Không cần xây engine agent mới, chỉ cấu hình lại tool set cho từng vai trò trên nền `queryAgent` sẵn có.

**5.3 Multi-agent orchestration**

Nhiều agent vai trò phối hợp trên cùng một ca bệnh: ví dụ Pharmacy agent phát hiện tương tác thuốc, đẩy phát hiện đó (dưới dạng evidence node có provenance, không phải kết luận) vào context của Treatment Recommendation agent. Phần này cần một lớp orchestrator mới nằm trên các `queryAgent` hiện có (điều phối thứ tự gọi, gộp evidence, tránh vòng lặp) — chưa có trong OHARA hôm nay, là việc xây mới thật sự.

**5.4 RL-trained retrieval trigger (Med-RwR)**

Thay bộ chọn tool bằng prompt Gemini (`agent_strategy.md`) bằng policy học qua RL. Có thể bootstrap reward từ dữ liệu REFEED RAG (thumbs up/down) đã thu thập sẵn trong collection `feedback`. Đây là hướng tham vọng nhất, đòi hỏi hạ tầng RL hoàn toàn mới, nên để riêng thành milestone nghiên cứu.

Cả 4 hướng đều hoãn sang phase 2. v1 nên dừng ở retrieval-only tiering đã có (mục 2, dòng "Principal/Integrity/Explorer"), chưa cần thêm agent loop, để giữ phạm vi buildable trong thời gian ngắn.
