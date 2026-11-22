// Ожидаемое поведение: схема с ошибкой в длительностях. Встроенный светодиод WS2812 (вывод 79)
// получает цвет 001000 (тусклый красный), но единица нулевого бита длится 14 тактов (519 нс):
// это между окнами нуля (200–500 нс) и единицы (550–1000 нс). Симулятор выдаёт событие
// timingError с измеренной длительностью; бит читается по ближайшему окну, цвет виден.
// Период бита 34 такта, пауза между кадрами 300 мкс.
// Проверочное число: за 0,9 мс проходят два кадра, в каждом 23 нулевых бита — 46 ошибок.
module top (
    input  wire clk,
    output wire din
);
    localparam integer T0H    = 14;  // ошибка: должно быть не больше 13 тактов (481 нс)
    localparam integer T1H    = 20;
    localparam integer TBIT   = 34;
    localparam integer TRESET = 8100;
    localparam [23:0]  COLOR  = 24'h00_10_00;  // порядок GRB: красный 0x10

    reg        sending = 0;
    reg [12:0] tcnt    = 0;
    reg [4:0]  bit_idx = 0;
    reg        out     = 0;

    wire cur_bit = COLOR[5'd23 - bit_idx];

    always @(posedge clk) begin
        if (!sending) begin
            out <= 1'b0;
            if (tcnt == TRESET - 1) begin
                sending <= 1'b1;
                tcnt    <= 0;
                bit_idx <= 0;
            end else begin
                tcnt <= tcnt + 1'b1;
            end
        end else begin
            out <= tcnt < (cur_bit ? T1H : T0H);
            if (tcnt == TBIT - 1) begin
                tcnt <= 0;
                if (bit_idx == 23) sending <= 1'b0;
                else bit_idx <= bit_idx + 1'b1;
            end else begin
                tcnt <= tcnt + 1'b1;
            end
        end
    end

    assign din = out;
endmodule
