// Урок 6, шаг 3: счётчик нажатий S1 с антидребезгом и синхронным сбросом от S2.
// S1 → синхронизатор → опрос раз в 10 мс → детектор фронта → счётчик +1.
// S2 → синхронизатор → сброс счётчика в 0 (пока S2 нажата, счётчик стоит на 0).
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88: +1
    input  wire       btn_s2,   // кнопка S2, вывод 87: сброс
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // Полярность кнопки: «нажата = 1» (проверено на плате, PULL_MODE=DOWN в top.cst).
    // Если на другой плате окажется «нажата = 0», поменять здесь 1'b1 на 1'b0 — и всё.
    localparam PRESSED = 1'b1;
    wire s1_in = (btn_s1 == PRESSED);        // 1 = нажата, при любой полярности
    wire s2_in = (btn_s2 == PRESSED);

    // Синхронизаторы: по два триггера на каждую кнопку.
    reg s1_meta = 1'b0, s1_sync = 1'b0;
    reg s2_meta = 1'b0, s2_sync = 1'b0;

    always @(posedge clk) begin
        s1_meta <= s1_in;
        s1_sync <= s1_meta;
        s2_meta <= s2_in;
        s2_sync <= s2_meta;
    end

    // Делитель антидребезга: тик раз в 10 мс (100 раз в секунду).
    localparam integer DB_LAST = CLK_HZ / 100 - 1;   // 269 999 при 27 МГц
                                                     // 269 999 < 2^19 = 524 288 → 19 бит
    reg  [18:0] db_div = 19'd0;
    wire        db_tick = (db_div == DB_LAST);       // 1 на один такт раз в 10 мс

    always @(posedge clk) begin
        if (db_tick) db_div <= 19'd0;
        else         db_div <= db_div + 1'b1;
    end

    // Антидребезг: смотрим на кнопку только по тику, раз в 10 мс.
    reg s1_db = 1'b0;

    always @(posedge clk)
        if (db_tick) s1_db <= s1_sync;

    // Детектор фронта — теперь на чистом сигнале s1_db.
    reg  s1_prev = 1'b0;
    wire s1_press = s1_db & ~s1_prev;        // 1 ровно на один такт после нажатия

    always @(posedge clk)
        s1_prev <= s1_db;

    // Счётчик нажатий с синхронным сбросом: сброс главнее, поэтому проверяется первым.
    // Дребезг S2 не страшен: сбросить в 0 пять раз подряд — то же, что один раз.
    reg [5:0] cnt = 6'd0;

    always @(posedge clk) begin
        if (s2_sync)       cnt <= 6'd0;
        else if (s1_press) cnt <= cnt + 1'b1;
    end

    assign led = ~cnt;   // LED0 — младший бит; светодиоды горят по нулю
endmodule
