// Урок 7, практика 3: перекрёсток + пешеходный переход через дорогу A.
// Пешеходный светофор — два внешних светодиода: красный (вывод 73), зелёный (вывод 74).
// S1 — кнопка вызова: заявка запоминается, и в следующей фазе «B едет»
// пешеходам загорается зелёный (дорога A в это время стоит на красном).
// Дорога A: LED0 красный, LED1 жёлтый, LED2 зелёный.
// Дорога B: LED3 красный, LED4 жёлтый, LED5 зелёный.
// Цикл: A едет → A мигает → A жёлтый → все красные → B красный+жёлтый → B едет →
//       B мигает → B жёлтый → все красные → A красный+жёлтый → A едет …
// S2 — синхронный сброс: «все красные», потом A; заявка тоже сбрасывается.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88: вызов пешехода
    input  wire       btn_s2,   // кнопка S2, вывод 87: сброс
    output wire [5:0] led,      // LED0..LED5, выводы 15..20, горят при 0
    output wire       ped_r,    // пешеходный красный, вывод 73, горит при 1
    output wire       ped_g     // пешеходный зелёный, вывод 74, горит при 1
);
    // Полярность кнопки: «нажата = 1» — проверено на плате.
    localparam PRESSED = 1'b1;
    wire s1_in = (btn_s1 == PRESSED);
    wire s2_in = (btn_s2 == PRESSED);

    // Синхронизаторы (урок 6).
    reg s1_meta = 1'b0, s1_sync = 1'b0;
    reg s2_meta = 1'b0, s2_sync = 1'b0;

    always @(posedge clk) begin
        s1_meta <= s1_in;
        s1_sync <= s1_meta;
        s2_meta <= s2_in;
        s2_sync <= s2_meta;
    end

    // S1: антидребезг опросом раз в 10 мс и детектор фронта (урок 6).
    localparam integer DB_LAST = CLK_HZ / 100 - 1;   // 269 999 → 19 бит
    reg  [18:0] db_div = 19'd0;
    wire        db_tick = (db_div == DB_LAST);

    always @(posedge clk) begin
        if (db_tick) db_div <= 19'd0;
        else         db_div <= db_div + 1'b1;
    end

    reg  s1_db = 1'b0, s1_prev = 1'b0;
    wire s1_press = s1_db & ~s1_prev;

    always @(posedge clk) begin
        if (db_tick) s1_db <= s1_sync;
        s1_prev <= s1_db;
    end

    // Делитель: тик раз в секунду, half = 1 в первой половине секунды.
    localparam integer SEC_LAST = CLK_HZ - 1;        // 26 999 999 → 25 бит
    localparam integer HALF     = CLK_HZ / 2;        // 0,5 с
    reg  [24:0] div = 25'd0;
    wire        sec_tick = (div == SEC_LAST);
    wire        half     = (div < HALF);

    always @(posedge clk) begin
        if (sec_tick || s2_sync) div <= 25'd0;
        else                     div <= div + 1'b1;
    end

    // Десять состояний — 4 бита.
    localparam [3:0] S_A_GO    = 4'd0,   // A зелёный,          B красный
                     S_A_BLINK = 4'd1,   // A зелёный мигает,   B красный
                     S_A_YEL   = 4'd2,   // A жёлтый,           B красный
                     S_RED_1   = 4'd3,   // все красные (дальше B)
                     S_B_RY    = 4'd4,   // A красный,          B красный + жёлтый
                     S_B_GO    = 4'd5,   // A красный,          B зелёный
                     S_B_BLINK = 4'd6,   // A красный,          B зелёный мигает
                     S_B_YEL   = 4'd7,   // A красный,          B жёлтый
                     S_RED_2   = 4'd8,   // все красные (дальше A)
                     S_A_RY    = 4'd9;   // A красный + жёлтый, B красный

    // Длительность фаз в секундах (самая длинная — 3 с, sec хватает 2 бит).
    localparam [1:0] T_GO    = 2'd3,     // зелёный
                     T_BLINK = 2'd2,     // зелёный мигает
                     T_YEL   = 2'd1,     // жёлтый
                     T_RED   = 2'd1,     // все красные
                     T_RY    = 2'd1;     // красный + жёлтый

    reg  [3:0] state = S_RED_2;  // старт с «все красные»
    reg  [3:0] next;
    reg  [1:0] sec = 2'd0;
    reg  [1:0] dur;
    reg  [2:0] a, b;             // лампы дорог A и B: {зелёный, жёлтый, красный}

    // Выходы автомата: лампы обеих дорог и длительность фазы.
    always @(*) begin
        case (state)
            S_A_GO:    begin a = 3'b100;        b = 3'b001;        dur = T_GO;    end
            S_A_BLINK: begin a = {half, 2'b00}; b = 3'b001;        dur = T_BLINK; end
            S_A_YEL:   begin a = 3'b010;        b = 3'b001;        dur = T_YEL;   end
            S_RED_1:   begin a = 3'b001;        b = 3'b001;        dur = T_RED;   end
            S_B_RY:    begin a = 3'b001;        b = 3'b011;        dur = T_RY;    end
            S_B_GO:    begin a = 3'b001;        b = 3'b100;        dur = T_GO;    end
            S_B_BLINK: begin a = 3'b001;        b = {half, 2'b00}; dur = T_BLINK; end
            S_B_YEL:   begin a = 3'b001;        b = 3'b010;        dur = T_YEL;   end
            S_RED_2:   begin a = 3'b001;        b = 3'b001;        dur = T_RED;   end
            S_A_RY:    begin a = 3'b011;        b = 3'b001;        dur = T_RY;    end
            default:   begin a = 3'b001;        b = 3'b001;        dur = T_RED;   end
        endcase
    end

    wire phase_end = sec_tick && (sec == dur - 1'b1);

    // Логика переходов: десять стрелок по кругу.
    always @(*) begin
        next = state;
        case (state)
            S_A_GO:    if (phase_end) next = S_A_BLINK;
            S_A_BLINK: if (phase_end) next = S_A_YEL;
            S_A_YEL:   if (phase_end) next = S_RED_1;
            S_RED_1:   if (phase_end) next = S_B_RY;
            S_B_RY:    if (phase_end) next = S_B_GO;
            S_B_GO:    if (phase_end) next = S_B_BLINK;
            S_B_BLINK: if (phase_end) next = S_B_YEL;
            S_B_YEL:   if (phase_end) next = S_RED_2;
            S_RED_2:   if (phase_end) next = S_A_RY;
            S_A_RY:    if (phase_end) next = S_A_GO;
            default:   next = S_RED_2;       // 10..15 — чужие: «все красные»
        endcase
    end

    always @(posedge clk) begin
        if (s2_sync) begin
            state <= S_RED_2;
            sec   <= 2'd0;
        end else begin
            state <= next;
            if (next != state) sec <= 2'd0;
            else if (sec_tick) sec <= sec + 1'b1;
        end
    end

    assign led = ~{b, a};   // LED5..LED3 — дорога B, LED2..LED0 — дорога A

    // Пешеходы. ped_req — заявка: «кто-то нажал S1 и ждёт».
    // ped_go — «в этой фазе B_GO пешеходы идут»: решается в момент входа в B_GO
    // и дальше не меняется до следующего входа.
    reg ped_req = 1'b0, ped_go = 1'b0;
    wire enter_b_go = (next == S_B_GO) && (state != S_B_GO);   // сейчас войдём в B_GO

    always @(posedge clk) begin
        if (s2_sync) begin
            ped_req <= 1'b0;
            ped_go  <= 1'b0;
        end else begin
            if (enter_b_go) begin
                ped_go  <= ped_req;          // была заявка — в этой фазе пешеходы идут
                ped_req <= s1_press;         // заявку обслужили (новая — на следующий круг)
            end else if (s1_press) begin
                ped_req <= 1'b1;             // запомнить нажатие
            end
        end
    end

    assign ped_g = (state == S_B_GO) && ped_go;  // зелёный — только пока стоит дорога A
    assign ped_r = ~ped_g;
endmodule
